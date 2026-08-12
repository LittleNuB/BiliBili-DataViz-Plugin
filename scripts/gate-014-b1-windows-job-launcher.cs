using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class Gate014B1WindowsJobLauncher
{
    private const string Contract = "gate-014-b1-windows-job-launcher-v1";
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const int JobObjectBasicAccountingInformationClass = 1;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private const int StdErrorHandle = -12;
    private const uint TerminationExitCode = 0xE014B101;
    private const int TerminationTimeoutMilliseconds = 5000;
    private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);
    private static readonly IntPtr ProcThreadAttributeHandleList = new IntPtr(0x00020002);
    private static readonly IntPtr ProcThreadAttributeJobList = new IntPtr(0x0002000D);

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        internal ulong ReadOperationCount;
        internal ulong WriteOperationCount;
        internal ulong OtherOperationCount;
        internal ulong ReadTransferCount;
        internal ulong WriteTransferCount;
        internal ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicAccountingInformation
    {
        internal long TotalUserTime;
        internal long TotalKernelTime;
        internal long ThisPeriodTotalUserTime;
        internal long ThisPeriodTotalKernelTime;
        internal uint TotalPageFaultCount;
        internal uint TotalProcesses;
        internal uint ActiveProcesses;
        internal uint TotalTerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        internal long PerProcessUserTimeLimit;
        internal long PerJobUserTimeLimit;
        internal uint LimitFlags;
        internal UIntPtr MinimumWorkingSetSize;
        internal UIntPtr MaximumWorkingSetSize;
        internal uint ActiveProcessLimit;
        internal UIntPtr Affinity;
        internal uint PriorityClass;
        internal uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        internal JobObjectBasicLimitInformation BasicLimitInformation;
        internal IoCounters IoInfo;
        internal UIntPtr ProcessMemoryLimit;
        internal UIntPtr JobMemoryLimit;
        internal UIntPtr PeakProcessMemoryUsed;
        internal UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        internal int cb;
        internal string lpReserved;
        internal string lpDesktop;
        internal string lpTitle;
        internal uint dwX;
        internal uint dwY;
        internal uint dwXSize;
        internal uint dwYSize;
        internal uint dwXCountChars;
        internal uint dwYCountChars;
        internal uint dwFillAttribute;
        internal uint dwFlags;
        internal short wShowWindow;
        internal short cbReserved2;
        internal IntPtr lpReserved2;
        internal IntPtr hStdInput;
        internal IntPtr hStdOutput;
        internal IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx
    {
        internal StartupInfo StartupInfo;
        internal IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        internal IntPtr hProcess;
        internal IntPtr hThread;
        internal uint dwProcessId;
        internal uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JobObjectExtendedLimitInformation information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(
        IntPtr job,
        int informationClass,
        out JobObjectBasicAccountingInformation information,
        uint informationLength,
        IntPtr returnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        [In] ref StartupInfoEx startupInfo,
        out ProcessInformation processInformation);

    [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr _get_osfhandle(int fileDescriptor);

    [DllImport("msvcrt.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int _close(int fileDescriptor);

    private sealed class NativeHandles : IDisposable
    {
        internal IntPtr Job = IntPtr.Zero;
        internal IntPtr Process = IntPtr.Zero;
        internal IntPtr NullInput = InvalidHandleValue;
        internal IntPtr NullOutput = InvalidHandleValue;

        public void Dispose()
        {
            if (Process != IntPtr.Zero && Process != InvalidHandleValue)
            {
                CloseHandle(Process);
                Process = IntPtr.Zero;
            }
            if (Job != IntPtr.Zero && Job != InvalidHandleValue)
            {
                CloseHandle(Job);
                Job = IntPtr.Zero;
            }
            if (NullInput != IntPtr.Zero && NullInput != InvalidHandleValue)
            {
                CloseHandle(NullInput);
                NullInput = InvalidHandleValue;
            }
            if (NullOutput != IntPtr.Zero && NullOutput != InvalidHandleValue)
            {
                CloseHandle(NullOutput);
                NullOutput = InvalidHandleValue;
            }
        }
    }

    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        if (args.Length < 1 || string.IsNullOrWhiteSpace(args[0]))
        {
            return Fail();
        }

        using (NativeHandles handles = new NativeHandles())
        {
            try
            {
                LaunchSuspendedInJob(args, handles);
                Console.WriteLine(Contract + " ready");
                string command = Console.ReadLine();
                if (command != "terminate")
                {
                    return Fail();
                }
                TerminateAndObserveEmpty(handles.Job);
                Console.WriteLine(Contract + " terminated");
                return 0;
            }
            catch
            {
                return Fail();
            }
        }
    }

    private static int Fail()
    {
        try
        {
            Console.WriteLine(Contract + " failed");
        }
        catch
        {
        }
        return 1;
    }

    private static void LaunchSuspendedInJob(string[] args, NativeHandles handles)
    {
        handles.Job = CreateJobObject(IntPtr.Zero, null);
        EnsureValidHandle(handles.Job);
        JobObjectExtendedLimitInformation limits = new JobObjectExtendedLimitInformation();
        limits.BasicLimitInformation.LimitFlags = JobObjectLimitKillOnJobClose;
        if (!SetInformationJobObject(
            handles.Job,
            JobObjectExtendedLimitInformationClass,
            ref limits,
            (uint)Marshal.SizeOf(typeof(JobObjectExtendedLimitInformation))))
        {
            throw new InvalidOperationException();
        }

        IntPtr cdpRead = _get_osfhandle(3);
        IntPtr cdpWrite = _get_osfhandle(4);
        EnsureValidHandle(cdpRead);
        EnsureValidHandle(cdpWrite);
        EnsureInheritable(cdpRead);
        EnsureInheritable(cdpWrite);

        handles.NullInput = CreateFile(
            "NUL",
            0x80000000,
            0x00000003,
            IntPtr.Zero,
            3,
            0x00000080,
            IntPtr.Zero);
        handles.NullOutput = CreateFile(
            "NUL",
            0x40000000,
            0x00000003,
            IntPtr.Zero,
            3,
            0x00000080,
            IntPtr.Zero);
        EnsureValidHandle(handles.NullInput);
        EnsureValidHandle(handles.NullOutput);
        EnsureInheritable(handles.NullInput);
        EnsureInheritable(handles.NullOutput);

        IntPtr stderrHandle = GetStdHandle(StdErrorHandle);
        if (stderrHandle == IntPtr.Zero || stderrHandle == InvalidHandleValue)
        {
            stderrHandle = handles.NullOutput;
        }
        EnsureInheritable(stderrHandle);

        List<IntPtr> inheritedHandles = new List<IntPtr>();
        AddUniqueHandle(inheritedHandles, cdpRead);
        AddUniqueHandle(inheritedHandles, cdpWrite);
        AddUniqueHandle(inheritedHandles, handles.NullInput);
        AddUniqueHandle(inheritedHandles, handles.NullOutput);
        AddUniqueHandle(inheritedHandles, stderrHandle);

        StartupInfoEx startupInfo = new StartupInfoEx();
        startupInfo.StartupInfo.cb = Marshal.SizeOf(typeof(StartupInfoEx));
        startupInfo.StartupInfo.dwFlags = 0x00000100;
        startupInfo.StartupInfo.hStdInput = handles.NullInput;
        startupInfo.StartupInfo.hStdOutput = handles.NullOutput;
        startupInfo.StartupInfo.hStdError = stderrHandle;

        IntPtr attributeListSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeListSize);
        if (attributeListSize == IntPtr.Zero)
        {
            throw new InvalidOperationException();
        }
        IntPtr attributeList = Marshal.AllocHGlobal(attributeListSize);
        IntPtr inheritedHandleBuffer = IntPtr.Zero;
        IntPtr jobListBuffer = IntPtr.Zero;
        ProcessInformation processInformation = new ProcessInformation();
        bool processCreated = false;
        bool processResumed = false;
        bool attributeListInitialized = false;
        try
        {
            if (!InitializeProcThreadAttributeList(attributeList, 2, 0, ref attributeListSize))
            {
                throw new InvalidOperationException();
            }
            attributeListInitialized = true;
            inheritedHandleBuffer = Marshal.AllocHGlobal(IntPtr.Size * inheritedHandles.Count);
            for (int index = 0; index < inheritedHandles.Count; index += 1)
            {
                Marshal.WriteIntPtr(inheritedHandleBuffer, index * IntPtr.Size, inheritedHandles[index]);
            }
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                ProcThreadAttributeHandleList,
                inheritedHandleBuffer,
                new IntPtr(IntPtr.Size * inheritedHandles.Count),
                IntPtr.Zero,
                IntPtr.Zero))
            {
                throw new InvalidOperationException();
            }
            jobListBuffer = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobListBuffer, handles.Job);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                ProcThreadAttributeJobList,
                jobListBuffer,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero))
            {
                throw new InvalidOperationException();
            }
            startupInfo.lpAttributeList = attributeList;
            string cdpHandles = SerializeHandle(cdpRead) + "," + SerializeHandle(cdpWrite);
            StringBuilder commandLine = BuildCommandLine(args, cdpHandles);
            processCreated = CreateProcess(
                args[0],
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                CreateNoWindow | CreateSuspended | CreateUnicodeEnvironment | ExtendedStartupInfoPresent,
                IntPtr.Zero,
                Path.GetDirectoryName(args[0]),
                ref startupInfo,
                out processInformation);
            if (!processCreated)
            {
                throw new InvalidOperationException();
            }
            if (ResumeThread(processInformation.hThread) == uint.MaxValue)
            {
                throw new InvalidOperationException();
            }
            processResumed = true;
            handles.Process = processInformation.hProcess;
            processInformation.hProcess = IntPtr.Zero;
        }
        finally
        {
            if (processCreated && !processResumed)
            {
                TerminateAndObserveEmpty(handles.Job);
            }
            if (processInformation.hThread != IntPtr.Zero)
            {
                CloseHandle(processInformation.hThread);
            }
            if (processInformation.hProcess != IntPtr.Zero)
            {
                CloseHandle(processInformation.hProcess);
            }
            if (attributeListInitialized)
            {
                DeleteProcThreadAttributeList(attributeList);
            }
            if (attributeList != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(attributeList);
            }
            if (inheritedHandleBuffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(inheritedHandleBuffer);
            }
            if (jobListBuffer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(jobListBuffer);
            }
        }

        _close(3);
        _close(4);
    }

    private static void TerminateAndObserveEmpty(IntPtr job)
    {
        Stopwatch stopwatch = Stopwatch.StartNew();
        TerminateAndObserveEmptyCore(
            delegate { return QueryActiveProcesses(job); },
            delegate { return TerminateJobObject(job, TerminationExitCode); },
            delegate { return stopwatch.ElapsedMilliseconds; },
            delegate(int milliseconds) { Thread.Sleep(milliseconds); });
    }

    internal static void TerminateAndObserveEmptyCore(
        Func<uint> queryActiveProcesses,
        Func<bool> terminateJob,
        Func<long> elapsedMilliseconds,
        Action<int> sleep)
    {
        uint activeBeforeTermination = queryActiveProcesses();
        EnsureTerminationDeadline(elapsedMilliseconds(), false);
        if (activeBeforeTermination == 0)
        {
            throw new InvalidOperationException();
        }
        if (!terminateJob())
        {
            throw new InvalidOperationException();
        }
        EnsureTerminationDeadline(elapsedMilliseconds(), false);
        while (true)
        {
            EnsureTerminationDeadline(elapsedMilliseconds(), false);
            uint activeProcesses = queryActiveProcesses();
            long observedAtMilliseconds = elapsedMilliseconds();
            if (activeProcesses == 0)
            {
                EnsureTerminationDeadline(observedAtMilliseconds, true);
                return;
            }
            EnsureTerminationDeadline(observedAtMilliseconds, false);
            sleep(10);
        }
    }

    private static void EnsureTerminationDeadline(
        long elapsedMilliseconds,
        bool allowExactDeadline)
    {
        if (
            elapsedMilliseconds > TerminationTimeoutMilliseconds ||
            (!allowExactDeadline &&
                elapsedMilliseconds == TerminationTimeoutMilliseconds))
        {
            throw new TimeoutException();
        }
    }

    private static uint QueryActiveProcesses(IntPtr job)
    {
        JobObjectBasicAccountingInformation accounting;
        if (!QueryInformationJobObject(
            job,
            JobObjectBasicAccountingInformationClass,
            out accounting,
            (uint)Marshal.SizeOf(typeof(JobObjectBasicAccountingInformation)),
            IntPtr.Zero))
        {
            throw new InvalidOperationException();
        }
        return accounting.ActiveProcesses;
    }

    private static void EnsureInheritable(IntPtr handle)
    {
        if (!SetHandleInformation(handle, HandleFlagInherit, HandleFlagInherit))
        {
            throw new InvalidOperationException();
        }
    }

    private static void EnsureValidHandle(IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == InvalidHandleValue)
        {
            throw new InvalidOperationException();
        }
    }

    private static void AddUniqueHandle(List<IntPtr> handles, IntPtr handle)
    {
        if (!handles.Contains(handle))
        {
            handles.Add(handle);
        }
    }

    private static string SerializeHandle(IntPtr handle)
    {
        ulong value = unchecked((ulong)handle.ToInt64());
        if (value > uint.MaxValue && (value >> 32) != uint.MaxValue)
        {
            throw new InvalidOperationException();
        }
        return unchecked((uint)value).ToString(System.Globalization.CultureInfo.InvariantCulture);
    }

    private static StringBuilder BuildCommandLine(string[] args, string cdpHandles)
    {
        List<string> command = new List<string>();
        command.Add(args[0]);
        for (int index = 1; index < args.Length; index += 1)
        {
            command.Add(args[index]);
        }
        command.Add("--remote-debugging-io-pipes=" + cdpHandles);
        StringBuilder result = new StringBuilder();
        for (int index = 0; index < command.Count; index += 1)
        {
            if (index > 0)
            {
                result.Append(' ');
            }
            result.Append(QuoteCommandLineArgument(command[index]));
        }
        return result;
    }

    private static string QuoteCommandLineArgument(string argument)
    {
        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int backslashCount = 0;
        foreach (char character in argument)
        {
            if (character == '\\')
            {
                backslashCount += 1;
                continue;
            }
            if (character == '"')
            {
                quoted.Append('\\', backslashCount * 2 + 1);
                quoted.Append('"');
                backslashCount = 0;
                continue;
            }
            quoted.Append('\\', backslashCount);
            backslashCount = 0;
            quoted.Append(character);
        }
        quoted.Append('\\', backslashCount * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
