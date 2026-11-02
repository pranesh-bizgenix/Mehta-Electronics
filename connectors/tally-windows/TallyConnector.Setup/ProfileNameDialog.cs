namespace TallyConnector.Setup;

public sealed class ProfileNameDialog : Form
{
    private readonly TextBox _nameTextBox = new() { Dock = DockStyle.Fill };

    public ProfileNameDialog()
    {
        Text = "Create connector profile";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterParent;
        MinimizeBox = false;
        MaximizeBox = false;
        ShowInTaskbar = false;
        ClientSize = new Size(420, 140);

        _nameTextBox.PlaceholderText = "Example: Company B";

        Button okButton = new() { Text = "Create", DialogResult = DialogResult.OK, AutoSize = true };
        Button cancelButton = new() { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };

        okButton.Click += (_, eventArgs) =>
        {
            if (string.IsNullOrWhiteSpace(ProfileName))
            {
                MessageBox.Show(this, "Enter a profile name.", "Profile name required", MessageBoxButtons.OK, MessageBoxIcon.Information);
                DialogResult = DialogResult.None;
            }
        };

        TableLayoutPanel layout = new()
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(14),
            ColumnCount = 1,
            RowCount = 3,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        layout.Controls.Add(new Label
        {
            Text = "Profile name",
            Dock = DockStyle.Fill,
            AutoSize = true,
        }, 0, 0);
        layout.Controls.Add(_nameTextBox, 0, 1);

        FlowLayoutPanel actions = new()
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
        };
        actions.Controls.Add(cancelButton);
        actions.Controls.Add(okButton);
        layout.Controls.Add(actions, 0, 2);

        Controls.Add(layout);
        AcceptButton = okButton;
        CancelButton = cancelButton;
    }

    public string ProfileName => _nameTextBox.Text.Trim();
}
