using System;
using System.IO;
using System.Text;
using System.Threading;
using Process = System.Diagnostics.Process;
using ProcessStartInfo = System.Diagnostics.ProcessStartInfo;

internal static class Gate014B1JobDescendantProbe
{
    private static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            return 2;
        }
        if (args[0] == "intermediate" && args.Length >= 2)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                Arguments = "grandchild " + args[1] + " " +
                    Process.GetCurrentProcess().Id.ToString(
                        System.Globalization.CultureInfo.InvariantCulture),
                UseShellExecute = false,
                CreateNoWindow = true,
            });
            return 0;
        }
        if (args[0] == "grandchild" && args.Length >= 3)
        {
            int parentProcessId = int.Parse(
                args[2],
                System.Globalization.CultureInfo.InvariantCulture);
            WaitForProcessExit(parentProcessId);
            string markerPath = Encoding.UTF8.GetString(
                Convert.FromBase64String(args[1]));
            File.WriteAllText(
                markerPath,
                Process.GetCurrentProcess().Id.ToString(
                    System.Globalization.CultureInfo.InvariantCulture));
            Thread.Sleep(60000);
            return 0;
        }
        if (args[0] == "stderr-flood" && args.Length >= 2)
        {
            string block = new string('x', 8192);
            for (int index = 0; index < 256; index += 1)
            {
                Console.Error.Write(block);
            }
            Console.Error.Flush();
            string markerPath = Encoding.UTF8.GetString(
                Convert.FromBase64String(args[1]));
            File.WriteAllText(markerPath, "ready");
            Thread.Sleep(60000);
            return 0;
        }
        return 3;
    }

    private static void WaitForProcessExit(int processId)
    {
        long startedAtTicks = DateTime.UtcNow.Ticks;
        while (
            (DateTime.UtcNow.Ticks - startedAtTicks) /
                TimeSpan.TicksPerMillisecond < 5000)
        {
            try
            {
                using (Process process = Process.GetProcessById(processId))
                {
                    if (process.HasExited)
                    {
                        return;
                    }
                }
            }
            catch (ArgumentException)
            {
                return;
            }
            Thread.Sleep(10);
        }
        Environment.Exit(4);
    }
}
