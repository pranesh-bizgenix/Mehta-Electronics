# Tally Connector Agent

This solution contains the customer-side Windows connector for the GI pairing flow.

## Projects

- `TallyConnector.Core`
  Shared pairing, DPAPI secret storage, retry queue, Tally XML collection, and upload logic.
- `TallyConnector.Service`
  The background Windows service that refreshes tokens, sends heartbeats, queues uploads, and syncs Tally every hour.
- `TallyConnector.Setup`
  The one-time setup UI for entering the pairing code, saving the connector configuration, and installing or starting the Windows service.

## Web app

```bash
pnpm install
pnpm dev          # http://localhost:3122 -> /dashboard
```

## Local data

The connector stores local files under:

`C:\ProgramData\Bizgenix\TallyConnector`

- `config\connector.json`
- `config\installation-id.txt`
- `config\sync-state.json`
- `queue\`
- `logs\`
- `updates\`
- `backup\`

Refresh and access tokens are DPAPI-protected before they are written to disk.

## Publish

Publish the Windows service payload:

```powershell
dotnet publish .\TallyConnector.Service\TallyConnector.Service.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -o .\publish\service
```

Publish the setup app:

```powershell
dotnet publish .\TallyConnector.Setup\TallyConnector.Setup.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -o .\publish\setup
```

Ship the setup app together with the published `service` payload folder. The setup app expects the service executable to be available beside it in a `service\` directory during installation.
