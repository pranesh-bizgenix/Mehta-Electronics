using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using TallyConnector.Core.Models;

namespace TallyConnector.Core.Services;

public sealed class ApiService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly HttpClient _httpClient;
    private readonly ConnectorConfigurationService _configurationService;

    public ApiService(ConnectorConfigurationService configurationService)
    {
        _configurationService = configurationService;
        _httpClient = new HttpClient
        {
            Timeout = TimeSpan.FromMinutes(2),
        };
    }

    public async Task<PairingResponse> PairAsync(string apiBaseUrl, PairingRequest request, CancellationToken cancellationToken)
    {
        string baseUrl = NormalizeBaseUrl(apiBaseUrl);
        return await PostJsonAsync<PairingResponse>(
            baseUrl,
            "/api/connectors/pair",
            request,
            bearerToken: null,
            cancellationToken);
    }

    public async Task<string> CheckServerAsync(string apiBaseUrl, CancellationToken cancellationToken)
    {
        using HttpRequestMessage request = new(HttpMethod.Get, BuildUri(apiBaseUrl, "/api/health"));
        using HttpResponseMessage response = await _httpClient.SendAsync(request, cancellationToken);
        return response.IsSuccessStatusCode
            ? $"GI server is reachable (HTTP {(int)response.StatusCode})."
            : $"GI server is reachable but reported HTTP {(int)response.StatusCode}. Check its database and deployment health.";
    }

    public async Task<ConnectorConfiguration> EnsureFreshAccessTokenAsync(
        ConnectorConfiguration configuration,
        CancellationToken cancellationToken)
    {
        if (!configuration.IsPaired)
        {
            throw new InvalidOperationException("The connector has not been paired.");
        }

        if (configuration.AccessTokenExpiresAt is DateTimeOffset expiresAt
            && expiresAt > DateTimeOffset.UtcNow.AddMinutes(2))
        {
            return configuration;
        }

        return await RefreshAsync(configuration, cancellationToken);
    }

    public async Task<ConnectorConfiguration> SendHeartbeatAsync(
        ConnectorConfiguration configuration,
        bool tallyAvailable,
        string? selectedCompany,
        string? selectedCompanyGuid,
        IReadOnlyList<OpenCompanyIdentity> openCompanies,
        SyncState state,
        DateTimeOffset? lastSyncAt,
        CancellationToken cancellationToken)
    {
        (ConnectorConfiguration updated, HeartbeatResponse response) = await SendWithRefreshAsync(
            configuration,
            async (current, bearerToken, tokenCancellationToken) =>
            {
                HeartbeatRequest request = new()
                {
                    AgentVersion = ConnectorMetadata.CurrentVersion,
                    ProfileName = current.ProfileName,
                    MachineName = current.MachineName,
                    TallyAvailable = tallyAvailable,
                    SelectedCompany = selectedCompany,
                    SelectedCompanyGuid = selectedCompanyGuid,
                    OpenCompanies = openCompanies
                        .Select(company => company.Name)
                        .Where(name => !string.IsNullOrWhiteSpace(name))
                        .Distinct(StringComparer.Ordinal)
                        .ToList(),
                    OpenCompanyIdentities = openCompanies
                        .Where(company => !string.IsNullOrWhiteSpace(company.Name))
                        .Select(company => new OpenCompanyIdentity
                        {
                            Name = company.Name,
                            Guid = company.Guid,
                        })
                        .ToList(),
                    LastSyncAt = ValidConnectorTimestamp(lastSyncAt),
                    HistorySyncInProgress = !state.InitialHistoryComplete,
                    NextHistoryFrom = state.NextHistoryFrom?.ToString("yyyy-MM-dd"),
                };

                HeartbeatResponse heartbeat = await PostJsonAsync<HeartbeatResponse>(
                    current.ApiBaseUrl,
                    "/api/connectors/heartbeat",
                    request,
                    bearerToken,
                    tokenCancellationToken);

                current.SyncIntervalSeconds = Math.Max(60, heartbeat.SyncIntervalSeconds);
                current.HistoryFinancialYears = ConnectorMetadata.NormalizeHistoryFinancialYears(heartbeat.HistoryFinancialYears);
                await _configurationService.SaveAsync(current, tokenCancellationToken);
                return heartbeat;
            },
            cancellationToken);

        updated.SyncIntervalSeconds = Math.Max(60, response.SyncIntervalSeconds);
        updated.HistoryFinancialYears = ConnectorMetadata.NormalizeHistoryFinancialYears(response.HistoryFinancialYears);
        return updated;
    }

    public async Task<string?> StartSyncJobAsync(
        ConnectorConfiguration configuration,
        string companyName,
        string? companyGuid,
        DateOnly syncFrom,
        DateOnly syncTo,
        string? syncId,
        CancellationToken cancellationToken)
    {
        (_, SyncJobStartResponse response) = await SendWithRefreshAsync(
            configuration,
            async (current, bearerToken, tokenCancellationToken) =>
                await PostJsonAsync<SyncJobStartResponse>(
                    current.ApiBaseUrl,
                    "/api/connectors/sync-job",
                    new
                    {
                        action = "start",
                        sourceSystem = "bizgenix",
                        syncId,
                        companyName,
                        companyGuid,
                        syncFrom = syncFrom.ToString("yyyy-MM-dd"),
                        syncTo = syncTo.ToString("yyyy-MM-dd"),
                    },
                    bearerToken,
                    tokenCancellationToken),
            cancellationToken);

        return string.IsNullOrWhiteSpace(response.SyncJobId)
            ? null
            : response.SyncJobId.Trim();
    }

    public async Task CompleteSyncJobAsync(
        ConnectorConfiguration configuration,
        string jobId,
        string status,
        int? recordCount,
        string? message,
        DateTimeOffset? lastSyncAt,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(jobId))
        {
            return;
        }

        await SendWithRefreshAsync(
            configuration,
            async (current, bearerToken, tokenCancellationToken) =>
                await PostJsonAsync<SyncJobCompleteResponse>(
                    current.ApiBaseUrl,
                    "/api/connectors/sync-job",
                    new
                    {
                        action = "complete",
                        jobId,
                        status,
                        recordCount,
                        message,
                        lastSyncAt = ValidConnectorTimestamp(lastSyncAt),
                    },
                    bearerToken,
                    tokenCancellationToken),
            cancellationToken);
    }

    public async Task<ConnectorConfiguration> UpdateSyncJobProgressAsync(
        ConnectorConfiguration configuration,
        string? jobId,
        int? recordCount,
        string? progressStep,
        int? progressPct,
        string? message,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(jobId))
        {
            return configuration;
        }

        (ConnectorConfiguration updated, _) = await SendWithRefreshAsync(
            configuration,
            async (current, bearerToken, tokenCancellationToken) =>
                await PostJsonAsync<SyncJobCompleteResponse>(
                    current.ApiBaseUrl,
                    "/api/connectors/sync-job",
                    new
                    {
                        action = "progress",
                        jobId,
                        recordCount,
                        progressStep,
                        progressPct,
                        message,
                    },
                    bearerToken,
                    tokenCancellationToken),
            cancellationToken);

        return updated;
    }

    public async Task<ConnectorConfiguration> UploadPackageAsync(
        ConnectorConfiguration configuration,
        PendingSyncPackage package,
        CancellationToken cancellationToken)
    {
        (ConnectorConfiguration updated, _) = await SendWithRefreshAsync(
            configuration,
            async (current, bearerToken, tokenCancellationToken) =>
            {
                ChunkStartResponse start = await PostGzipJsonAsync<ChunkStartResponse>(
                    current.ApiBaseUrl,
                    "/api/ingest/tally/chunks",
                    BuildChunkStartPayload(package),
                    bearerToken,
                    tokenCancellationToken);

                if (string.IsNullOrWhiteSpace(start.SessionId))
                {
                    throw new InvalidOperationException("The server did not return a chunk session id.");
                }

                foreach (string field in EnumeratePackageFields(package))
                {
                    int sequence = 0;
                    await foreach (string chunk in ReadFieldChunksAsync(package, field, tokenCancellationToken))
                    {
                        await PostGzipJsonAsync<ChunkAckResponse>(
                            current.ApiBaseUrl,
                            "/api/ingest/tally/chunks",
                            new
                            {
                                action = "append",
                                sessionId = start.SessionId,
                                field,
                                sequence,
                                content = chunk,
                            },
                            bearerToken,
                            tokenCancellationToken);
                        sequence += 1;
                    }
                }

                await PostGzipJsonAsync<ChunkAckResponse>(
                    current.ApiBaseUrl,
                    "/api/ingest/tally/chunks",
                    new
                    {
                        action = "finalize",
                        sessionId = start.SessionId,
                    },
                    bearerToken,
                    tokenCancellationToken);

                return true;
            },
            cancellationToken);

        return updated;
    }

    private async Task<ConnectorConfiguration> RefreshAsync(
        ConnectorConfiguration configuration,
        CancellationToken cancellationToken)
    {
        string refreshToken = await _configurationService.GetRefreshTokenAsync(configuration, cancellationToken)
            ?? throw new InvalidOperationException("The connector refresh token is missing.");

        RefreshResponse response;
        try
        {
            response = await PostJsonAsync<RefreshResponse>(
                configuration.ApiBaseUrl,
                "/api/connectors/refresh",
                new RefreshRequest { RefreshToken = refreshToken },
                bearerToken: null,
                cancellationToken);
        }
        catch (ApiException exception) when (exception.StatusCode == HttpStatusCode.Unauthorized && IsPermanentCredentialError(exception.Message))
        {
            await _configurationService.ClearPairingAsync(configuration, cancellationToken);
            throw new InvalidOperationException("The connector pairing was revoked or expired. Generate a new pairing code in GI and pair this PC again.", exception);
        }

        return await _configurationService.SaveRefreshAsync(configuration, response, cancellationToken);
    }

    private async Task<(ConnectorConfiguration Configuration, T Result)> SendWithRefreshAsync<T>(
        ConnectorConfiguration configuration,
        Func<ConnectorConfiguration, string, CancellationToken, Task<T>> action,
        CancellationToken cancellationToken)
    {
        ConnectorConfiguration current = await EnsureFreshAccessTokenAsync(configuration, cancellationToken);
        string accessToken = await _configurationService.GetAccessTokenAsync(current, cancellationToken)
            ?? throw new InvalidOperationException("The connector access token is missing.");

        try
        {
            T result = await action(current, accessToken, cancellationToken);
            return (current, result);
        }
        catch (ApiException exception) when (exception.StatusCode == HttpStatusCode.Unauthorized)
        {
            current = await RefreshAsync(current, cancellationToken);
            accessToken = await _configurationService.GetAccessTokenAsync(current, cancellationToken)
                ?? throw new InvalidOperationException("The connector access token is missing.");
            T result = await action(current, accessToken, cancellationToken);
            return (current, result);
        }
    }

    private async Task<T> PostJsonAsync<T>(
        string apiBaseUrl,
        string relativePath,
        object payload,
        string? bearerToken,
        CancellationToken cancellationToken)
    {
        using HttpRequestMessage request = new(HttpMethod.Post, BuildUri(apiBaseUrl, relativePath));
        if (!string.IsNullOrWhiteSpace(bearerToken))
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        string json = JsonSerializer.Serialize(payload, JsonOptions);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return await SendAsync<T>(request, cancellationToken);
    }

    private async Task<T> PostGzipJsonAsync<T>(
        string apiBaseUrl,
        string relativePath,
        object payload,
        string bearerToken,
        CancellationToken cancellationToken)
    {
        using HttpRequestMessage request = new(HttpMethod.Post, BuildUri(apiBaseUrl, relativePath));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        request.Content = CreateGzipJsonContent(payload);
        return await SendAsync<T>(request, cancellationToken);
    }

    private async Task<T> SendAsync<T>(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        using HttpResponseMessage response = await _httpClient.SendAsync(request, cancellationToken);
        string raw = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new ApiException(response.StatusCode, ExtractErrorMessage(raw));
        }

        T? result = JsonSerializer.Deserialize<T>(raw, JsonOptions);
        if (result is null)
        {
            throw new InvalidOperationException("The server returned an empty response.");
        }

        return result;
    }

    private static ByteArrayContent CreateGzipJsonContent(object payload)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        using MemoryStream output = new();
        using (GZipStream gzip = new(output, CompressionLevel.SmallestSize, leaveOpen: true))
        {
            gzip.Write(bytes, 0, bytes.Length);
        }

        ByteArrayContent content = new(output.ToArray());
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        content.Headers.ContentEncoding.Add("gzip");
        return content;
    }

    private static Uri BuildUri(string apiBaseUrl, string relativePath) =>
        new($"{NormalizeBaseUrl(apiBaseUrl)}{relativePath}", UriKind.Absolute);

    private static string NormalizeBaseUrl(string value) => value.Trim().TrimEnd('/');

    private static string ExtractErrorMessage(string raw)
    {
        try
        {
            using JsonDocument document = JsonDocument.Parse(raw);
            if (document.RootElement.TryGetProperty("error", out JsonElement error))
            {
                return error.GetString() ?? raw;
            }
        }
        catch
        {
            // Ignore non-JSON errors and fall back to the raw body.
        }

        return string.IsNullOrWhiteSpace(raw) ? "The server rejected the request." : raw;
    }

    private static bool IsPermanentCredentialError(string message) =>
        message.Contains("refresh token has been revoked", StringComparison.OrdinalIgnoreCase)
        || message.Contains("refresh token is invalid", StringComparison.OrdinalIgnoreCase)
        || message.Contains("refresh token has expired", StringComparison.OrdinalIgnoreCase)
        || message.Contains("connector is no longer active", StringComparison.OrdinalIgnoreCase);

    private static DateTimeOffset? ValidConnectorTimestamp(DateTimeOffset? value)
    {
        if (value is null || value.Value.Year < 2024)
        {
            return null;
        }

        return value;
    }

    private static IEnumerable<string> ChunkText(string value, int chunkSize = 4_500_000)
    {
        int start = 0;
        while (start < value.Length)
        {
            int end = Math.Min(value.Length, start + chunkSize);
            if (end < value.Length && char.IsHighSurrogate(value[end - 1]))
            {
                end -= 1;
            }

            if (end <= start)
            {
                end = Math.Min(value.Length, start + chunkSize);
            }

            yield return value[start..end];
            start = end;
        }
    }

    private static IEnumerable<string> EnumeratePackageFields(PendingSyncPackage package)
    {
        if (package.FieldNames.Count > 0)
        {
            return package.FieldNames;
        }

        return package.Fields.Keys;
    }

    private static async IAsyncEnumerable<string> ReadFieldChunksAsync(
        PendingSyncPackage package,
        string field,
        [EnumeratorCancellation] CancellationToken cancellationToken,
        int chunkSize = 4_500_000)
    {
        if (package.Fields.TryGetValue(field, out string? inlineContent))
        {
            foreach (string chunk in ChunkText(inlineContent, chunkSize))
            {
                yield return chunk;
            }

            yield break;
        }

        string fieldPath = ConnectorPaths.QueuePackageFieldFile(package.PackageId, field);
        if (!File.Exists(fieldPath))
        {
            throw new FileNotFoundException($"Queued field file was not found for {field}.", fieldPath);
        }

        using FileStream stream = File.OpenRead(fieldPath);
        using StreamReader reader = new(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        char[] buffer = new char[chunkSize];
        string carry = "";
        while (true)
        {
            int read = await reader.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken);
            if (read == 0)
            {
                break;
            }

            string chunk = carry + new string(buffer, 0, read);
            carry = "";
            if (chunk.Length > 0 && char.IsHighSurrogate(chunk[^1]))
            {
                carry = chunk[^1].ToString();
                chunk = chunk[..^1];
            }

            if (chunk.Length > 0)
            {
                yield return chunk;
            }
        }

        if (carry.Length > 0)
        {
            yield return carry;
        }
    }

    private static Dictionary<string, object> BuildChunkStartPayload(PendingSyncPackage package)
    {
        Dictionary<string, object> payload = new(StringComparer.Ordinal)
        {
            ["action"] = "start",
            ["company"] = package.CompanyName,
            ["from"] = package.From.ToString("yyyy-MM-dd"),
            ["to"] = package.To.ToString("yyyy-MM-dd"),
            ["asOf"] = package.AsOf.ToString("yyyy-MM-dd"),
            ["syncId"] = package.SyncId,
            ["sourceSystem"] = "bizgenix",
            ["retryCount"] = package.AttemptCount,
        };

        if (!string.IsNullOrWhiteSpace(package.CompanyGuid))
        {
            payload["companyGuid"] = package.CompanyGuid.Trim();
        }

        if (!string.IsNullOrWhiteSpace(package.PublicationMode))
        {
            payload["publicationMode"] = package.PublicationMode.Trim();
        }

        if (!string.IsNullOrWhiteSpace(package.SyncJobId))
        {
            payload["syncJobId"] = package.SyncJobId.Trim();
        }

        if (package.HistoryCoveredFrom.HasValue)
        {
            payload["historyCoveredFrom"] = package.HistoryCoveredFrom.Value.ToString("yyyy-MM-dd");
        }

        return payload;
    }

    private sealed class ChunkStartResponse
    {
        public bool Ok { get; set; }

        public string SessionId { get; set; } = "";
    }

    private sealed class SyncJobStartResponse
    {
        public bool Ok { get; set; }

        public string? SyncJobId { get; set; }
    }

    private sealed class SyncJobCompleteResponse
    {
        public bool Ok { get; set; }
    }

    private sealed class ChunkAckResponse
    {
        public bool Ok { get; set; }
    }

    private sealed class ApiException : Exception
    {
        public ApiException(HttpStatusCode statusCode, string message)
            : base(message)
        {
            StatusCode = statusCode;
        }

        public HttpStatusCode StatusCode { get; }
    }
}
