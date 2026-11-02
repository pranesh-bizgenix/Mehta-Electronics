using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace TallyConnector.Core.Services;

public static class CredentialProtector
{
    private const int CryptProtectUiForbidden = 0x1;
    private const int CryptProtectLocalMachine = 0x4;

    public static string ProtectToBase64(string value)
    {
        EnsureWindows();

        byte[] plainBytes = Encoding.UTF8.GetBytes(value);
        DataBlob input = ToBlob(plainBytes);
        try
        {
            if (!CryptProtectData(
                ref input,
                szDataDescr: null,
                pOptionalEntropy: IntPtr.Zero,
                pvReserved: IntPtr.Zero,
                pPromptStruct: IntPtr.Zero,
                CryptProtectUiForbidden | CryptProtectLocalMachine,
                out DataBlob output))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "DPAPI encryption failed.");
            }

            try
            {
                byte[] protectedBytes = FromBlob(output);
                return Convert.ToBase64String(protectedBytes);
            }
            finally
            {
                if (output.PbData != IntPtr.Zero)
                {
                    LocalFree(output.PbData);
                }
            }
        }
        finally
        {
            FreeBlob(input);
        }
    }

    public static string UnprotectFromBase64(string protectedValue)
    {
        EnsureWindows();

        byte[] protectedBytes = Convert.FromBase64String(protectedValue);
        DataBlob input = ToBlob(protectedBytes);
        try
        {
            if (!CryptUnprotectData(
                ref input,
                ppszDataDescr: IntPtr.Zero,
                pOptionalEntropy: IntPtr.Zero,
                pvReserved: IntPtr.Zero,
                pPromptStruct: IntPtr.Zero,
                CryptProtectUiForbidden,
                out DataBlob output))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "DPAPI decryption failed.");
            }

            try
            {
                byte[] plainBytes = FromBlob(output);
                return Encoding.UTF8.GetString(plainBytes);
            }
            finally
            {
                if (output.PbData != IntPtr.Zero)
                {
                    LocalFree(output.PbData);
                }
            }
        }
        finally
        {
            FreeBlob(input);
        }
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("DPAPI protection requires Windows.");
        }
    }

    private static DataBlob ToBlob(byte[] data)
    {
        DataBlob blob = new()
        {
            CbData = data.Length,
            PbData = Marshal.AllocHGlobal(data.Length),
        };
        Marshal.Copy(data, 0, blob.PbData, data.Length);
        return blob;
    }

    private static byte[] FromBlob(DataBlob blob)
    {
        if (blob.CbData <= 0 || blob.PbData == IntPtr.Zero)
        {
            return [];
        }

        byte[] bytes = new byte[blob.CbData];
        Marshal.Copy(blob.PbData, bytes, 0, blob.CbData);
        return bytes;
    }

    private static void FreeBlob(DataBlob blob)
    {
        if (blob.PbData != IntPtr.Zero)
        {
            Marshal.FreeHGlobal(blob.PbData);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int CbData;

        public IntPtr PbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out DataBlob pDataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr hMem);
}
