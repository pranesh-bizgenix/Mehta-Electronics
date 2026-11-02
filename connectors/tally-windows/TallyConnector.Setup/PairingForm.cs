using System.Diagnostics;
using TallyConnector.Core.Models;
using TallyConnector.Core.Services;

namespace TallyConnector.Setup;

public sealed class PairingForm : Form
{
    private const string LogoRelativePath = @"Assets\gi-logo-monogram-lockup-transparent.png";

    private readonly ConnectorConfigurationService _configurationService;
    private readonly ConnectorProfileCatalogService _profileCatalogService;
    private readonly ApiService _apiService;
    private readonly TallyService _tallyService;
    private readonly CancellationTokenSource _shutdown = new();
    private Image? _logoImage;
    private bool _loadingProfiles;
    private bool _currentProfilePaired;

    private readonly ComboBox _profileComboBox = new() { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
    private readonly Button _addProfileButton = new() { Text = "Add Profile", AutoSize = true };
    private readonly Button _deleteProfileButton = new() { Text = "Delete Profile", AutoSize = true };
    private readonly TextBox _apiUrlTextBox = new() { Dock = DockStyle.Fill };
    private readonly TextBox _pairingCodeTextBox = new() { Dock = DockStyle.Fill, CharacterCasing = CharacterCasing.Upper };
    private readonly ComboBox _preferredCompanyComboBox = new()
    {
        Dock = DockStyle.Fill,
        DropDownStyle = ComboBoxStyle.DropDown,
        AutoCompleteMode = AutoCompleteMode.SuggestAppend,
        AutoCompleteSource = AutoCompleteSource.ListItems,
    };
    private readonly TextBox _tallyUrlTextBox = new() { Dock = DockStyle.Fill };
    private readonly Label _preferredCompanyHintLabel = new() { Dock = DockStyle.Fill, AutoSize = true };
    private readonly Label _statusLabel = new() { Dock = DockStyle.Fill, AutoSize = true };
    private readonly Label _detailsLabel = new() { Dock = DockStyle.Fill, AutoSize = true };
    private readonly Button _connectButton = new() { Text = "Connect and Start Service", AutoSize = true };
    private readonly Button _installButton = new() { Text = "Install/Start Service", AutoSize = true };
    private readonly Button _openFolderButton = new() { Text = "Open Data Folder", AutoSize = true };
    private readonly Button _loadCompaniesButton = new() { Text = "Load from Tally", AutoSize = true };

    public PairingForm(
        ConnectorConfigurationService configurationService,
        ConnectorProfileCatalogService profileCatalogService,
        ApiService apiService,
        TallyService tallyService)
    {
        _configurationService = configurationService;
        _profileCatalogService = profileCatalogService;
        _apiService = apiService;
        _tallyService = tallyService;

        Text = "Bizgenix Tally Connector";
        MinimumSize = new Size(880, 430);
        StartPosition = FormStartPosition.CenterScreen;

        _apiUrlTextBox.Text = ConnectorMetadata.DefaultApiBaseUrl;
        _tallyUrlTextBox.Text = ConnectorMetadata.DefaultTallyBaseUrl;
        _pairingCodeTextBox.PlaceholderText = "BGX-123456";
        _preferredCompanyComboBox.Text = "";
        _preferredCompanyHintLabel.Text = "Reads currently open company names from Tally. One company is auto-selected; choose from the list if multiple are open.";
        _preferredCompanyHintLabel.ForeColor = Color.DimGray;
        _statusLabel.Text = "Status: Not connected";
        _statusLabel.Font = new Font(Font, FontStyle.Bold);
        _detailsLabel.Text = "The connector stores a device-specific refresh token locally and syncs in the background after pairing.";
        _profileComboBox.DisplayMember = nameof(ConnectorProfile.Name);
        _profileComboBox.ValueMember = nameof(ConnectorProfile.Id);

        BuildLayout();

        Load += async (_, _) => await InitializeAsync();
        FormClosed += (_, _) => _shutdown.Cancel();
        _connectButton.Click += async (_, _) => await PairAndInstallAsync();
        _installButton.Click += async (_, _) => await InstallServiceAsync();
        _loadCompaniesButton.Click += async (_, _) => await RefreshOpenCompaniesAsync(showErrors: true, preferCurrentSelection: true);
        _openFolderButton.Click += (_, _) => OpenDataFolder();
        _profileComboBox.SelectedIndexChanged += async (_, _) => await HandleProfileChangedAsync();
        _addProfileButton.Click += async (_, _) => await AddProfileAsync();
        _deleteProfileButton.Click += async (_, _) => await DeleteProfileAsync();
    }

    private void BuildLayout()
    {
        TableLayoutPanel layout = new()
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
            ColumnCount = 2,
            RowCount = 9,
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 28));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 72));
        for (int row = 0; row < 8; row++)
        {
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        }

        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        FlowLayoutPanel actions = new()
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.LeftToRight,
            AutoSize = true,
            WrapContents = true,
        };
        actions.Controls.AddRange([_connectButton, _installButton, _openFolderButton]);

        layout.Controls.Add(BuildHeader(), 0, 0);
        layout.SetColumnSpan(layout.GetControlFromPosition(0, 0)!, 2);
        layout.Controls.Add(new Label { Text = "Profile", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 1);
        layout.Controls.Add(BuildProfileControl(), 1, 1);
        layout.Controls.Add(new Label { Text = "GI Server URL", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 2);
        layout.Controls.Add(_apiUrlTextBox, 1, 2);
        layout.Controls.Add(new Label { Text = "Pairing Code", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 3);
        layout.Controls.Add(_pairingCodeTextBox, 1, 3);
        layout.Controls.Add(new Label { Text = "Preferred Company", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 4);
        layout.Controls.Add(BuildPreferredCompanyControl(), 1, 4);
        layout.Controls.Add(_preferredCompanyHintLabel, 1, 5);
        layout.Controls.Add(new Label { Text = "Tally URL", Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft }, 0, 6);
        layout.Controls.Add(_tallyUrlTextBox, 1, 6);
        layout.Controls.Add(actions, 0, 7);
        layout.SetColumnSpan(actions, 2);

        TableLayoutPanel statusPanel = new()
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(0, 10, 0, 0),
            ColumnCount = 1,
            RowCount = 2,
            AutoSize = true,
        };
        statusPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        statusPanel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        statusPanel.Controls.Add(_statusLabel, 0, 0);
        statusPanel.Controls.Add(_detailsLabel, 0, 1);
        layout.Controls.Add(statusPanel, 0, 8);
        layout.SetColumnSpan(statusPanel, 2);

        Controls.Add(layout);
    }

    private Control BuildProfileControl()
    {
        TableLayoutPanel profilePanel = new()
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            Margin = new Padding(0),
        };
        profilePanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        profilePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        profilePanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        profilePanel.Controls.Add(_profileComboBox, 0, 0);
        profilePanel.Controls.Add(_addProfileButton, 1, 0);
        profilePanel.Controls.Add(_deleteProfileButton, 2, 0);
        return profilePanel;
    }

    private Control BuildPreferredCompanyControl()
    {
        TableLayoutPanel companyPanel = new()
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            Margin = new Padding(0),
        };
        companyPanel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        companyPanel.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        companyPanel.Controls.Add(_preferredCompanyComboBox, 0, 0);
        companyPanel.Controls.Add(_loadCompaniesButton, 1, 0);
        return companyPanel;
    }

    private Control BuildHeader()
    {
        TableLayoutPanel header = new()
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 2,
            Margin = new Padding(0, 0, 0, 6),
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));

        TableLayoutPanel textPanel = new()
        {
            Dock = DockStyle.Fill,
            AutoSize = true,
            ColumnCount = 1,
            RowCount = 2,
            Margin = new Padding(8, 3, 0, 0),
        };

        Label title = new()
        {
            Text = "Connect Tally to Bizgenix AI",
            Dock = DockStyle.Fill,
            Font = new Font(Font.FontFamily, 15, FontStyle.Bold),
            AutoSize = true,
        };

        Label subtitle = new()
        {
            Text = "Enter the one-time pairing code shown on the GI website. After this step, the Windows service starts automatically, catches up older books financial year by financial year, and then refreshes the latest data every hour.",
            Dock = DockStyle.Fill,
            AutoSize = true,
            MaximumSize = new Size(680, 0),
        };

        textPanel.Controls.Add(title, 0, 0);
        textPanel.Controls.Add(subtitle, 0, 1);

        header.Controls.Add(CreateLogoControl(), 0, 0);
        header.Controls.Add(textPanel, 1, 0);

        return header;
    }

    private Control CreateLogoControl()
    {
        PictureBox logo = new()
        {
            Dock = DockStyle.Fill,
            SizeMode = PictureBoxSizeMode.Zoom,
            Margin = new Padding(0),
            MinimumSize = new Size(88, 88),
        };

        string logoPath = Path.Combine(AppContext.BaseDirectory, LogoRelativePath);
        if (File.Exists(logoPath))
        {
            _logoImage?.Dispose();
            _logoImage = Image.FromFile(logoPath);
            logo.Image = _logoImage;
        }

        return logo;
    }

    private string CurrentProfileId =>
        _profileComboBox.SelectedItem is ConnectorProfile profile
            ? profile.Id
            : ConnectorPaths.DefaultProfileId;

    private string CurrentProfileName =>
        _profileComboBox.SelectedItem is ConnectorProfile profile
            ? profile.Name
            : "Default profile";

    private void ApplySelectedProfileContext() =>
        ConnectorPaths.SetCurrentProfile(CurrentProfileId);

    private ServiceInstaller CreateServiceInstaller() =>
        new(CurrentProfileId, CurrentProfileName);

    private async Task InitializeAsync()
    {
        await LoadProfilesAsync(ConnectorPaths.DefaultProfileId);
        await LoadCurrentConfigurationAsync();
    }

    private async Task LoadProfilesAsync(string? selectedProfileId)
    {
        _loadingProfiles = true;
        try
        {
            List<ConnectorProfile> profiles = (await _profileCatalogService.ListAsync(_shutdown.Token)).ToList();
            _profileComboBox.BeginUpdate();
            try
            {
                _profileComboBox.DataSource = profiles;
            }
            finally
            {
                _profileComboBox.EndUpdate();
            }

            string normalized = ConnectorPaths.NormalizeProfileId(selectedProfileId);
            ConnectorProfile? selected = profiles.FirstOrDefault((profile) => string.Equals(profile.Id, normalized, StringComparison.Ordinal))
                ?? profiles.FirstOrDefault();
            _profileComboBox.SelectedItem = selected;
        }
        finally
        {
            _loadingProfiles = false;
        }
    }

    private async Task HandleProfileChangedAsync()
    {
        if (_loadingProfiles)
        {
            return;
        }

        await LoadCurrentConfigurationAsync();
    }

    private async Task LoadCurrentConfigurationAsync()
    {
        ApplySelectedProfileContext();
        ConnectorConfiguration? configuration = await _configurationService.LoadAsync(_shutdown.Token);
        if (configuration is null || !configuration.IsPaired)
        {
            _currentProfilePaired = false;
            _connectButton.Text = "Connect and Start Service";
            if (configuration is not null)
            {
                _apiUrlTextBox.Text = string.IsNullOrWhiteSpace(configuration.ApiBaseUrl)
                    ? ConnectorMetadata.DefaultApiBaseUrl
                    : configuration.ApiBaseUrl;
                _preferredCompanyComboBox.Text = configuration.PreferredCompany ?? "";
                _tallyUrlTextBox.Text = configuration.TallyBaseUrl;
            }
            else
            {
                _apiUrlTextBox.Text = ConnectorMetadata.DefaultApiBaseUrl;
                _preferredCompanyComboBox.Text = "";
                _tallyUrlTextBox.Text = ConnectorMetadata.DefaultTallyBaseUrl;
            }

            PrepareManualCompanyLoadPrompt();
            SetStatus("Status: Not connected", $"Profile \"{CurrentProfileName}\" is ready to pair. Generate a pairing code on the GI website, enter it here, and this same local profile will be used.", true);
            return;
        }

        _currentProfilePaired = true;
        _connectButton.Text = "Re-pair and Restart Service";
        _apiUrlTextBox.Text = string.IsNullOrWhiteSpace(configuration.ApiBaseUrl)
            ? ConnectorMetadata.DefaultApiBaseUrl
            : configuration.ApiBaseUrl;
        _preferredCompanyComboBox.Text = configuration.PreferredCompany ?? "";
        _tallyUrlTextBox.Text = configuration.TallyBaseUrl;
        PrepareManualCompanyLoadPrompt();
        ServiceRuntimeState serviceState = await CreateServiceInstaller().GetServiceStateAsync(_shutdown.Token);
        SetStatus(
            StatusHeadingFor(serviceState),
            BuildStatusDetail(CurrentProfileName, configuration, serviceState),
            serviceState == ServiceRuntimeState.Running);
    }

    private async Task PairAndInstallAsync()
    {
        bool repairingExistingProfile = _currentProfilePaired;
        ToggleBusy(true);
        bool pairingSaved = false;
        try
        {
            ApplySelectedProfileContext();
            string apiBaseUrl = SelectedApiBaseUrl();
            string pairingCode = _pairingCodeTextBox.Text.Trim().ToUpperInvariant();
            await _configurationService.SaveManualSettingsAsync(
                apiBaseUrl,
                SelectedPreferredCompany(),
                _tallyUrlTextBox.Text,
                CurrentProfileName,
                _shutdown.Token);

            if (string.IsNullOrWhiteSpace(pairingCode))
            {
                throw new InvalidOperationException("Enter the pairing code shown on the website.");
            }

            string installationId = await _configurationService.GetOrCreateInstallationIdAsync(_shutdown.Token);
            PairingResponse response = await _apiService.PairAsync(
                apiBaseUrl,
                new PairingRequest
                {
                    PairingCode = pairingCode,
                    ProfileName = CurrentProfileName,
                    InstallationId = installationId,
                    MachineName = Environment.MachineName,
                    AgentVersion = ConnectorMetadata.CurrentVersion,
                },
                _shutdown.Token);

            await _configurationService.SavePairingAsync(
                response,
                installationId,
                Environment.MachineName,
                apiBaseUrl,
                SelectedPreferredCompany(),
                _tallyUrlTextBox.Text,
                _shutdown.Token,
                profileName: CurrentProfileName);
            pairingSaved = true;

            await CreateServiceInstaller().InstallOrUpdateAsync(_shutdown.Token);

            _pairingCodeTextBox.Clear();
            await LoadCurrentConfigurationAsync();
        }
        catch (Exception exception)
        {
            SetStatus(
                pairingSaved
                    ? "Status: Paired, service install failed"
                    : repairingExistingProfile ? "Status: Re-pairing failed" : "Status: Pairing failed",
                pairingSaved
                    ? $"Pairing was saved successfully, but the Windows service could not be installed or started.{Environment.NewLine}{exception.Message}"
                    : exception.Message,
                false);
        }
        finally
        {
            ToggleBusy(false);
        }
    }

    private async Task InstallServiceAsync()
    {
        ToggleBusy(true);
        try
        {
            ApplySelectedProfileContext();
            await _configurationService.SaveManualSettingsAsync(
                SelectedApiBaseUrl(),
                SelectedPreferredCompany(),
                _tallyUrlTextBox.Text,
                CurrentProfileName,
                _shutdown.Token);
            await CreateServiceInstaller().InstallOrUpdateAsync(_shutdown.Token);
            await LoadCurrentConfigurationAsync();
        }
        catch (Exception exception)
        {
            SetStatus("Status: Service install failed", exception.Message, false);
        }
        finally
        {
            ToggleBusy(false);
        }
    }

    private void OpenDataFolder()
    {
        ApplySelectedProfileContext();
        ConnectorPaths.EnsureDirectories();
        Process.Start(new ProcessStartInfo
        {
            FileName = ConnectorPaths.RootDirectory,
            UseShellExecute = true,
            Verb = "open",
        });
    }

    private void ToggleBusy(bool busy)
    {
        _connectButton.Enabled = !busy;
        _installButton.Enabled = !busy;
        _openFolderButton.Enabled = !busy;
        _loadCompaniesButton.Enabled = !busy;
        _preferredCompanyComboBox.Enabled = !busy;
        _apiUrlTextBox.Enabled = !busy;
        _profileComboBox.Enabled = !busy;
        _addProfileButton.Enabled = !busy;
        _deleteProfileButton.Enabled = !busy;
        UseWaitCursor = busy;
    }

    private static string NormalizeBaseUrl(string value) => value.Trim().TrimEnd('/');

    private string SelectedApiBaseUrl()
    {
        string value = NormalizeBaseUrl(_apiUrlTextBox.Text);
        if (!Uri.TryCreate(value, UriKind.Absolute, out Uri? uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || string.IsNullOrWhiteSpace(uri.Host))
        {
            throw new InvalidOperationException("Enter a valid GI Server URL beginning with http:// or https://.");
        }

        return value;
    }

    private async Task RefreshOpenCompaniesAsync(bool showErrors, bool preferCurrentSelection)
    {
        ApplySelectedProfileContext();
        string tallyUrl = _tallyUrlTextBox.Text.Trim();
        if (string.IsNullOrWhiteSpace(tallyUrl))
        {
            SetPreferredCompanyHint("Enter the Tally URL to load open company names.", false);
            return;
        }

        try
        {
            _loadCompaniesButton.Enabled = false;
            _loadCompaniesButton.Text = "Loading...";
            string current = preferCurrentSelection ? SelectedPreferredCompany() ?? "" : "";
            IReadOnlyList<string> companies = await _tallyService.ListOpenCompanyNamesAsync(tallyUrl, _shutdown.Token);
            _preferredCompanyComboBox.BeginUpdate();
            try
            {
                _preferredCompanyComboBox.Items.Clear();
                _preferredCompanyComboBox.Items.AddRange(companies.Cast<object>().ToArray());
            }
            finally
            {
                _preferredCompanyComboBox.EndUpdate();
            }

            if (companies.Count == 1)
            {
                _preferredCompanyComboBox.Text = companies[0];
                SetPreferredCompanyHint("One open company found in Tally. It has been selected automatically.", false);
                return;
            }

            if (!string.IsNullOrWhiteSpace(current) && companies.Contains(current, StringComparer.Ordinal))
            {
                _preferredCompanyComboBox.Text = current;
                SetPreferredCompanyHint($"{companies.Count} open companies found in Tally. The saved company is still selected.", false);
                return;
            }

            if (companies.Count > 1)
            {
                if (string.IsNullOrWhiteSpace(current))
                {
                    _preferredCompanyComboBox.SelectedIndex = -1;
                    _preferredCompanyComboBox.Text = "";
                }

                SetPreferredCompanyHint($"{companies.Count} open companies found in Tally. Select the exact company from the list.", false);
                return;
            }

            SetPreferredCompanyHint("No open companies were returned by Tally. Open the company in Tally and try again.", true);
        }
        catch (Exception exception)
        {
            if (showErrors)
            {
                SetPreferredCompanyHint(exception.Message, true);
            }
        }
        finally
        {
            _loadCompaniesButton.Text = "Load from Tally";
            _loadCompaniesButton.Enabled = true;
        }
    }

    private void PrepareManualCompanyLoadPrompt()
    {
        string current = SelectedPreferredCompany() ?? "";
        _preferredCompanyComboBox.BeginUpdate();
        try
        {
            _preferredCompanyComboBox.Items.Clear();
            if (!string.IsNullOrWhiteSpace(current))
            {
                _preferredCompanyComboBox.Items.Add(current);
            }
        }
        finally
        {
            _preferredCompanyComboBox.EndUpdate();
        }

        SetPreferredCompanyHint("Click Load from Tally after Tally is open to refresh company names.", false);
    }

    private async Task AddProfileAsync()
    {
        using ProfileNameDialog dialog = new();
        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        ToggleBusy(true);
        try
        {
            ConnectorProfile profile = await _profileCatalogService.CreateProfileAsync(dialog.ProfileName, _shutdown.Token);
            await LoadProfilesAsync(profile.Id);
            await LoadCurrentConfigurationAsync();
        }
        catch (Exception exception)
        {
            SetStatus("Status: Profile creation failed", exception.Message, false);
        }
        finally
        {
            ToggleBusy(false);
        }
    }

    private async Task DeleteProfileAsync()
    {
        if (CurrentProfileId == ConnectorPaths.DefaultProfileId)
        {
            SetStatus("Status: Default profile retained", "Create additional profiles for extra GI accounts. The default profile stays available for backward compatibility.", false);
            return;
        }

        DialogResult confirm = MessageBox.Show(
            this,
            $"Delete profile \"{CurrentProfileName}\" and remove its Windows service, local queue, and saved tokens?",
            "Delete connector profile",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (confirm != DialogResult.Yes)
        {
            return;
        }

        ToggleBusy(true);
        try
        {
            await CreateServiceInstaller().UninstallAsync(true, _shutdown.Token);
            await _profileCatalogService.DeleteProfileAsync(CurrentProfileId, _shutdown.Token);
            await LoadProfilesAsync(ConnectorPaths.DefaultProfileId);
            await LoadCurrentConfigurationAsync();
        }
        catch (Exception exception)
        {
            SetStatus("Status: Profile delete failed", exception.Message, false);
        }
        finally
        {
            ToggleBusy(false);
        }
    }

    private string? SelectedPreferredCompany()
    {
        string value = _preferredCompanyComboBox.Text.Trim();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private void SetPreferredCompanyHint(string message, bool error)
    {
        _preferredCompanyHintLabel.Text = message;
        _preferredCompanyHintLabel.ForeColor = error ? Color.DarkRed : Color.DimGray;
    }

    private static string StatusHeadingFor(ServiceRuntimeState state) =>
        state switch
        {
            ServiceRuntimeState.Running => "Status: Connected",
            ServiceRuntimeState.Missing => "Status: Paired, service not installed",
            ServiceRuntimeState.Stopped => "Status: Paired, service stopped",
            ServiceRuntimeState.StartPending => "Status: Paired, service starting",
            ServiceRuntimeState.StopPending => "Status: Paired, service stopping",
            _ => "Status: Paired, service status unknown",
        };

    private static string BuildStatusDetail(string profileName, ConnectorConfiguration configuration, ServiceRuntimeState serviceState)
    {
        string guidance = serviceState switch
        {
            ServiceRuntimeState.Running => "The Windows service is installed and running.",
            ServiceRuntimeState.Missing => "Click Install/Start Service to install the Windows service on this PC.",
            ServiceRuntimeState.Stopped => "Click Install/Start Service to start the Windows service on this PC.",
            ServiceRuntimeState.StartPending => "The Windows service is still starting. Wait a few seconds and refresh the screen.",
            ServiceRuntimeState.StopPending => "The Windows service is still stopping. Wait a few seconds and try Install/Start Service again.",
            _ => "The pairing is saved, but the Windows service state could not be confirmed yet.",
        };

        return
            $"Profile: {profileName}{Environment.NewLine}" +
            $"Connector ID: {configuration.ConnectorId}{Environment.NewLine}" +
            $"Machine: {configuration.MachineName}{Environment.NewLine}" +
            $"Last paired: {configuration.LastPairedAt?.LocalDateTime:G}{Environment.NewLine}" +
            $"Service state: {ServiceInstaller.DescribeState(serviceState)}{Environment.NewLine}" +
            guidance + Environment.NewLine +
            "To repair a revoked connection, generate a new pairing code in GI, enter it in this same profile, and click Re-pair and Restart Service.";
    }

    private void SetStatus(string heading, string detail, bool ok)
    {
        _statusLabel.Text = heading;
        _statusLabel.ForeColor = ok ? Color.DarkGreen : Color.DarkRed;
        _detailsLabel.Text = detail;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _logoImage?.Dispose();
            _shutdown.Dispose();
        }

        base.Dispose(disposing);
    }
}
