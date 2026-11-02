using Microsoft.Extensions.Logging;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed class SyncService
{
    private readonly ConnectorConfigurationService _configurationService;
    private readonly SyncStateService _syncStateService;
    private readonly QueueService _queueService;
    private readonly TallyService _tallyService;
    private readonly ApiService _apiService;
    private readonly ILogger<SyncService> _logger;

    public SyncService(
        ConnectorConfigurationService configurationService,
        SyncStateService syncStateService,
        QueueService queueService,
        TallyService tallyService,
        ApiService apiService,
        ILogger<SyncService> logger)
    {
        _configurationService = configurationService;
        _syncStateService = syncStateService;
        _queueService = queueService;
        _tallyService = tallyService;
        _apiService = apiService;
        _logger = logger;
    }

    public async Task RunCycleAsync(CancellationToken cancellationToken)
    {
        ConnectorConfiguration? configuration = await _configurationService.LoadAsync(cancellationToken);
        if (configuration is null || !configuration.IsPaired)
        {
            _logger.LogWarning("The connector has not been paired yet.");
            return;
        }

        SyncState state = await _syncStateService.LoadAsync(cancellationToken);
        state.LastSuccessfulSyncAt = ValidConnectorTimestamp(state.LastSuccessfulSyncAt);
        if (state.RefreshBackoffUntil is DateTimeOffset backoffUntil && backoffUntil > DateTimeOffset.UtcNow)
        {
            state.LastError = $"GI token refresh is rate-limited. Waiting until {backoffUntil.LocalDateTime:G} before trying again.";
            await _syncStateService.SaveAsync(state, cancellationToken);
            _logger.LogInformation("Skipping connector cycle until {BackoffUntil} because GI token refresh is rate-limited.", backoffUntil);
            return;
        }

        int deletedLegacyPackages = await _queueService.DeleteLegacyOversizedPackagesAsync(cancellationToken);
        if (deletedLegacyPackages > 0)
        {
            _logger.LogInformation("Removed {Count} legacy oversized sync package(s) so the connector can rebuild history in smaller batches.", deletedLegacyPackages);
            state.PendingPackageCount = Math.Max(0, state.PendingPackageCount - deletedLegacyPackages);
            state.LastError = null;
        }

        int splitOversizedPackages = await SplitOversizedHistoryPackagesAsync(state, cancellationToken);
        if (splitOversizedPackages > 0)
        {
            state.PendingPackageCount = Math.Max(0, state.PendingPackageCount - splitOversizedPackages);
            state.LastError = null;
        }

        string? selectedCompany = state.LastCompanyName ?? configuration.PreferredCompany;
        string? selectedCompanyGuid = state.LastCompanyGuid;
        bool tallyAvailable = false;
        bool tallyAvailabilityKnown = false;
        IReadOnlyList<OpenCompanyIdentity> openCompanies = Array.Empty<OpenCompanyIdentity>();

        try
        {
            configuration = await _apiService.EnsureFreshAccessTokenAsync(configuration, cancellationToken);
            tallyAvailable = await _tallyService.IsAvailableAsync(configuration, cancellationToken);
            tallyAvailabilityKnown = true;
            if (tallyAvailable)
            {
                try
                {
                    openCompanies = await _tallyService.ListOpenCompaniesAsync(configuration.TallyBaseUrl, cancellationToken);
                    if (openCompanies.Count == 0)
                    {
                        selectedCompany = null;
                        selectedCompanyGuid = null;
                    }
                    else if (!string.IsNullOrWhiteSpace(configuration.PreferredCompany))
                    {
                        OpenCompanyIdentity? preferred = openCompanies.FirstOrDefault(company =>
                            string.Equals(company.Name, configuration.PreferredCompany, StringComparison.Ordinal));
                        if (preferred is not null)
                        {
                            selectedCompany = preferred.Name;
                            selectedCompanyGuid = preferred.Guid;
                        }
                        else
                        {
                            selectedCompany = null;
                            selectedCompanyGuid = null;
                        }
                    }
                    else if (!string.IsNullOrWhiteSpace(selectedCompanyGuid))
                    {
                        OpenCompanyIdentity? previousGuid = openCompanies.FirstOrDefault(company =>
                            string.Equals(company.Guid, selectedCompanyGuid, StringComparison.Ordinal));
                        if (previousGuid is not null)
                        {
                            selectedCompany = previousGuid.Name;
                            selectedCompanyGuid = previousGuid.Guid;
                        }
                    }
                    else if (!string.IsNullOrWhiteSpace(selectedCompany))
                    {
                        OpenCompanyIdentity? previousName = openCompanies.FirstOrDefault(company =>
                            string.Equals(company.Name, selectedCompany, StringComparison.Ordinal));
                        if (previousName is not null)
                        {
                            selectedCompany = previousName.Name;
                            selectedCompanyGuid = previousName.Guid;
                        }
                    }
                    else if (openCompanies.Count == 1)
                    {
                        selectedCompany = openCompanies[0].Name;
                        selectedCompanyGuid = openCompanies[0].Guid;
                    }
                }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception, "Could not enumerate open Tally companies for heartbeat.");
                    openCompanies = Array.Empty<OpenCompanyIdentity>();
                }
            }
            else
            {
                selectedCompany = null;
                selectedCompanyGuid = null;
            }

            configuration = await SendProgressHeartbeatAsync(
                configuration,
                tallyAvailable,
                selectedCompany,
                selectedCompanyGuid,
                openCompanies,
                state,
                cancellationToken);
            bool companyAvailable = tallyAvailable && !string.IsNullOrWhiteSpace(selectedCompany);
            bool becameAvailable = tallyAvailable && state.LastTallyAvailable is false;
            bool becameCompanyAvailable = companyAvailable && state.LastCompanyAvailable is false;
            int pendingCount = await _queueService.CountPendingAsync(cancellationToken);

            if (pendingCount > 0)
            {
                configuration = await FlushQueueAsync(configuration, state, cancellationToken);
                pendingCount = await _queueService.CountPendingAsync(cancellationToken);
            }

            ApplyHistoryWindowPolicy(configuration, state);

            if (companyAvailable && pendingCount == 0 && ShouldCollectSnapshot(configuration, state, becameAvailable || becameCompanyAvailable))
            {
                if (becameAvailable || becameCompanyAvailable)
                {
                    _logger.LogInformation("Tally company became available again; collecting a fresh snapshot immediately.");
                }

                state.LastAttemptAt = DateTimeOffset.UtcNow;
                TallyService.PreparedSyncContext prepared = await _tallyService.PrepareSyncAsync(configuration, state, cancellationToken);
                selectedCompany = prepared.CompanyName;
                selectedCompanyGuid = prepared.CompanyGuid;
                string syncId = Guid.NewGuid().ToString();
                string? syncJobId = await TryStartSyncJobAsync(configuration, prepared, syncId, cancellationToken);
                configuration = await SendProgressHeartbeatAsync(
                    configuration,
                    tallyAvailable,
                    selectedCompany,
                    selectedCompanyGuid,
                    openCompanies,
                    state,
                    cancellationToken);

                try
                {
                    TallySnapshot snapshot = await _tallyService.CollectSnapshotAsync(
                        configuration,
                        prepared,
                        cancellationToken,
                        async (progress, progressCancellationToken) =>
                        {
                            configuration = await TryUpdateSyncJobProgressAsync(
                                configuration,
                                syncJobId,
                                progress.RecordCount,
                                progress.Step,
                                progress.ProgressPct,
                                progress.Message,
                                progressCancellationToken);
                        });
                    await _queueService.EnqueueAsync(CreatePackage(snapshot, syncId, syncJobId), cancellationToken);
                    pendingCount = await _queueService.CountPendingAsync(cancellationToken);
                }
                catch (Exception exception)
                {
                    await TryCompleteSyncJobAsync(configuration, syncJobId, "failed", 0, exception.Message, null, cancellationToken);
                    throw;
                }
            }

            if (pendingCount > 0)
            {
                // Flush again so a freshly collected snapshot uploads in the same cycle.
                configuration = await FlushQueueAsync(configuration, state, cancellationToken);
                pendingCount = await _queueService.CountPendingAsync(cancellationToken);
            }

            state.PendingPackageCount = pendingCount;
            state.LastHeartbeatAt = DateTimeOffset.UtcNow;
            state.RefreshBackoffUntil = null;
            state.LastError = null;
            if (tallyAvailabilityKnown)
            {
                state.LastTallyAvailable = tallyAvailable;
                state.LastCompanyAvailable = companyAvailable;
            }
            await _syncStateService.SaveAsync(state, cancellationToken);
            await SendProgressHeartbeatAsync(
                configuration,
                tallyAvailable,
                selectedCompany,
                selectedCompanyGuid,
                openCompanies,
                state,
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            if (IsRefreshRateLimit(exception))
            {
                state.RefreshBackoffUntil = DateTimeOffset.UtcNow.AddMinutes(10);
            }

            state.LastError = exception.Message;
            state.PendingPackageCount = await _queueService.CountPendingAsync(cancellationToken);
            if (tallyAvailabilityKnown)
            {
                state.LastTallyAvailable = tallyAvailable;
                state.LastCompanyAvailable = tallyAvailable && !string.IsNullOrWhiteSpace(selectedCompany);
            }
            await _syncStateService.SaveAsync(state, cancellationToken);
            _logger.LogError(exception, "Connector cycle failed.");

            try
            {
                await SendProgressHeartbeatAsync(
                    configuration,
                    tallyAvailable,
                    selectedCompany,
                    selectedCompanyGuid,
                    openCompanies,
                    state,
                    cancellationToken);
            }
            catch
            {
                // Heartbeat is best-effort after a failed cycle.
            }
        }
    }

    private async Task<ConnectorConfiguration> FlushQueueAsync(
        ConnectorConfiguration configuration,
        SyncState state,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<PendingSyncPackage> duePackages = await _queueService.GetDuePackagesAsync(DateTimeOffset.UtcNow, cancellationToken);
        ConnectorConfiguration current = configuration;
        foreach (PendingSyncPackage package in duePackages)
        {
            try
            {
                current = await _apiService.UploadPackageAsync(current, package, cancellationToken);
                await _queueService.MarkSucceededAsync(package.PackageId, cancellationToken);
                state.LastSuccessfulSyncAt = DateTimeOffset.UtcNow;
                state.LastCompanyGuid = package.CompanyGuid;
                state.LastCompanyName = package.CompanyName;
                state.LastSyncId = package.SyncId;
                state.InitialHistoryComplete = state.InitialHistoryComplete || package.InitialHistoryCompleteAfterUpload;
                state.NextHistoryFrom = package.InitialHistoryCompleteAfterUpload
                    ? null
                    : package.NextHistoryFrom ?? state.NextHistoryFrom;
                if (package.InitialHistoryCompleteAfterUpload)
                {
                    state.HistoryBatchMonths = null;
                }

                state.LastError = null;
                _logger.LogInformation(
                    "Uploaded sync package {PackageId} for {CompanyName} ({VoucherCount} vouchers).",
                    package.PackageId,
                    package.CompanyName,
                    package.VoucherCount);
            }
            catch (Exception exception)
            {
                if (IsOversizedUploadRejection(exception))
                {
                    await _queueService.MarkSucceededAsync(package.PackageId, cancellationToken);
                    state.InitialHistoryComplete = false;
                    state.NextHistoryFrom = package.From;
                    state.HistoryBatchMonths = SmallerHistoryBatchMonths(package, state.HistoryBatchMonths);
                    state.LastError = null;
                    await TryCompleteSyncJobAsync(
                        current,
                        package.SyncJobId,
                        "failed",
                        package.VoucherCount,
                        $"Package was too large; retrying from {package.From:yyyy-MM-dd} in {state.HistoryBatchMonths}-month batch(es).",
                        null,
                        cancellationToken);
                    _logger.LogInformation(
                        "Discarded oversized sync package {PackageId}; retrying {From} -> {To} in {BatchMonths}-month batch(es).",
                        package.PackageId,
                        package.From,
                        package.To,
                        state.HistoryBatchMonths);
                    continue;
                }

                if (IsPlanWindowRejection(exception))
                {
                    await _queueService.MarkSucceededAsync(package.PackageId, cancellationToken);
                    _logger.LogInformation(
                        "Discarded queued sync package {PackageId} because it is outside the current GI plan history window.",
                        package.PackageId);
                    continue;
                }

                await _queueService.MarkFailedAsync(package, exception.Message, cancellationToken);
                _logger.LogWarning(exception, "Deferred sync package {PackageId} for retry.", package.PackageId);
                break;
            }
        }

        return current;
    }

    private async Task<int> SplitOversizedHistoryPackagesAsync(SyncState state, CancellationToken cancellationToken)
    {
        IReadOnlyList<PendingSyncPackage> pendingPackages = await _queueService.GetAllPendingAsync(cancellationToken);
        int deleted = 0;
        foreach (PendingSyncPackage package in pendingPackages)
        {
            if (!IsOversizedUploadRejection(package.LastError))
            {
                continue;
            }

            await _queueService.MarkSucceededAsync(package.PackageId, cancellationToken);
            state.InitialHistoryComplete = false;
            if (state.NextHistoryFrom is null || package.From < state.NextHistoryFrom.Value)
            {
                state.NextHistoryFrom = package.From;
            }

            state.HistoryBatchMonths = SmallerHistoryBatchMonths(package, state.HistoryBatchMonths);
            deleted++;
            _logger.LogInformation(
                "Removed oversized queued package {PackageId}; history will retry from {From} in {BatchMonths}-month batch(es).",
                package.PackageId,
                package.From,
                state.HistoryBatchMonths);
        }

        return deleted;
    }

    private async Task<ConnectorConfiguration> SendProgressHeartbeatAsync(
        ConnectorConfiguration configuration,
        bool tallyAvailable,
        string? selectedCompany,
        string? selectedCompanyGuid,
        IReadOnlyList<OpenCompanyIdentity> openCompanies,
        SyncState state,
        CancellationToken cancellationToken)
    {
        ConnectorConfiguration updated = await _apiService.SendHeartbeatAsync(
            configuration,
            tallyAvailable,
            selectedCompany,
            selectedCompanyGuid,
            openCompanies,
            state,
            ValidConnectorTimestamp(state.LastSuccessfulSyncAt),
            cancellationToken);
        state.LastHeartbeatAt = DateTimeOffset.UtcNow;
        return updated;
    }

    private async Task<string?> TryStartSyncJobAsync(
        ConnectorConfiguration configuration,
        TallyService.PreparedSyncContext prepared,
        string syncId,
        CancellationToken cancellationToken)
    {
        try
        {
            return await _apiService.StartSyncJobAsync(
                configuration,
                prepared.CompanyName,
                prepared.CompanyGuid,
                prepared.Plan.VoucherFrom,
                prepared.Plan.VoucherTo,
                syncId,
                cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not register a running sync job before snapshot collection.");
            return null;
        }
    }

    private async Task TryCompleteSyncJobAsync(
        ConnectorConfiguration configuration,
        string? syncJobId,
        string status,
        int? recordCount,
        string? message,
        DateTimeOffset? lastSyncAt,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(syncJobId))
        {
            return;
        }

        try
        {
            await _apiService.CompleteSyncJobAsync(
                configuration,
                syncJobId,
                status,
                recordCount,
                message,
                lastSyncAt,
                cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not update sync job {SyncJobId} to {Status}.", syncJobId, status);
        }
    }

    private async Task<ConnectorConfiguration> TryUpdateSyncJobProgressAsync(
        ConnectorConfiguration configuration,
        string? syncJobId,
        int? recordCount,
        string? progressStep,
        int? progressPct,
        string? message,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(syncJobId))
        {
            return configuration;
        }

        try
        {
            return await _apiService.UpdateSyncJobProgressAsync(
                configuration,
                syncJobId,
                recordCount,
                progressStep,
                progressPct,
                message,
                cancellationToken);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not update sync job {SyncJobId} progress.", syncJobId);
            return configuration;
        }
    }

    private static bool ShouldCollectSnapshot(ConnectorConfiguration configuration, SyncState state, bool becameAvailable)
    {
        if (becameAvailable)
        {
            return true;
        }

        if (!state.InitialHistoryComplete)
        {
            return true;
        }

        DateTimeOffset now = DateTimeOffset.UtcNow;
        DateTimeOffset? lastAttempt = state.LastAttemptAt;
        if (lastAttempt is null)
        {
            return true;
        }

        return now - lastAttempt.Value >= TimeSpan.FromSeconds(Math.Max(60, configuration.SyncIntervalSeconds));
    }

    private static bool IsPlanWindowRejection(Exception exception) =>
        exception.Message.Contains("This plan allows Tally sync from", StringComparison.OrdinalIgnoreCase);

    private static bool IsRefreshRateLimit(Exception exception) =>
        exception.Message.Contains("Too many refresh attempts", StringComparison.OrdinalIgnoreCase);

    private static bool IsOversizedUploadRejection(Exception exception) =>
        IsOversizedUploadRejection(exception.Message);

    private static bool IsOversizedUploadRejection(string? message) =>
        !string.IsNullOrWhiteSpace(message)
        && (message.Contains("Tally upload exceeded the server chunk session safety budget", StringComparison.OrdinalIgnoreCase)
            || message.Contains("Raw Tally snapshot exceeds the server safety limit", StringComparison.OrdinalIgnoreCase)
            || message.Contains("Tally snapshot is too large", StringComparison.OrdinalIgnoreCase));

    private static int SmallerHistoryBatchMonths(PendingSyncPackage package, int? currentBatchMonths)
    {
        int current = currentBatchMonths is 1 or 3
            ? currentBatchMonths.Value
            : MonthsInclusive(package.From, package.To);
        return current > 3 ? 3 : 1;
    }

    private static int MonthsInclusive(DateOnly from, DateOnly to) =>
        Math.Max(1, ((to.Year - from.Year) * 12) + to.Month - from.Month + 1);

    private void ApplyHistoryWindowPolicy(ConnectorConfiguration configuration, SyncState state)
    {
        int currentYears = ConnectorMetadata.NormalizeHistoryFinancialYears(configuration.HistoryFinancialYears);
        DateOnly allowedStart = TallyXmlRequests.InitialHistoryStart(DateOnly.FromDateTime(DateTime.Today), currentYears);
        if (state.HistoryFinancialYears is null)
        {
            state.HistoryFinancialYears = currentYears;
            if (state.NextHistoryFrom.HasValue && state.NextHistoryFrom.Value < allowedStart)
            {
                state.NextHistoryFrom = allowedStart;
            }

            return;
        }

        int previousYears = ConnectorMetadata.NormalizeHistoryFinancialYears(state.HistoryFinancialYears.Value);
        state.HistoryFinancialYears = currentYears;
        if (currentYears > previousYears)
        {
            state.InitialHistoryComplete = false;
            state.NextHistoryFrom = allowedStart;
            state.LastError = null;
            _logger.LogInformation(
                "Connector plan history window increased from {PreviousYears} to {CurrentYears} financial years; reopening history sync from {AllowedStart}.",
                previousYears,
                currentYears,
                allowedStart);
            return;
        }

        if (state.NextHistoryFrom.HasValue && state.NextHistoryFrom.Value < allowedStart)
        {
            state.NextHistoryFrom = allowedStart;
        }
    }

    private static DateTimeOffset? ValidConnectorTimestamp(DateTimeOffset? value)
    {
        if (value is null || value.Value.Year < 2024)
        {
            return null;
        }

        return value;
    }

    private static PendingSyncPackage CreatePackage(TallySnapshot snapshot, string syncId, string? syncJobId) =>
        new()
        {
            PackageId = Guid.NewGuid().ToString(),
            SyncId = syncId,
            SyncJobId = string.IsNullOrWhiteSpace(syncJobId) ? null : syncJobId,
            CompanyName = snapshot.CompanyName,
            CompanyGuid = snapshot.CompanyGuid,
            From = snapshot.From,
            To = snapshot.To,
            AsOf = snapshot.AsOf,
            PublicationMode = snapshot.PublicationMode,
            HistoryCoveredFrom = snapshot.HistoryCoveredFrom,
            NextHistoryFrom = snapshot.NextHistoryFrom,
            InitialHistoryCompleteAfterUpload = snapshot.InitialHistoryCompleteAfterUpload,
            VoucherCount = snapshot.VoucherCount,
            GeneratedAt = DateTimeOffset.UtcNow,
            NextAttemptAt = DateTimeOffset.UtcNow,
            Fields = snapshot.Fields,
        };
}
