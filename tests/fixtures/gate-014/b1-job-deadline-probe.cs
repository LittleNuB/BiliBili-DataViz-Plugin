using System;

internal static class Gate014B1JobDeadlineProbe
{
    private static int Main()
    {
        if (!RejectsSlowPrecheck())
        {
            return 1;
        }
        if (!RejectsSlowTermination())
        {
            return 2;
        }
        if (!AcceptsEmptyReadbackAtDeadline())
        {
            return 3;
        }
        if (!RejectsEmptyReadbackAfterDeadline())
        {
            return 4;
        }
        return 0;
    }

    private static bool RejectsSlowPrecheck()
    {
        int terminationCalls = 0;
        try
        {
            Gate014B1WindowsJobLauncher.TerminateAndObserveEmptyCore(
                delegate { return 1U; },
                delegate { terminationCalls += 1; return true; },
                delegate { return 5000L; },
                delegate { });
        }
        catch (TimeoutException)
        {
            return terminationCalls == 0;
        }
        return false;
    }

    private static bool RejectsSlowTermination()
    {
        int elapsedCalls = 0;
        int queryCalls = 0;
        try
        {
            Gate014B1WindowsJobLauncher.TerminateAndObserveEmptyCore(
                delegate { queryCalls += 1; return 1U; },
                delegate { return true; },
                delegate { return elapsedCalls++ == 0 ? 0L : 5000L; },
                delegate { });
        }
        catch (TimeoutException)
        {
            return queryCalls == 1;
        }
        return false;
    }

    private static bool AcceptsEmptyReadbackAtDeadline()
    {
        int queryCalls = 0;
        try
        {
            Gate014B1WindowsJobLauncher.TerminateAndObserveEmptyCore(
                delegate { queryCalls += 1; return queryCalls == 1 ? 1U : 0U; },
                delegate { return true; },
                delegate
                {
                    if (queryCalls < 2)
                    {
                        return 4999L;
                    }
                    return 5000L;
                },
                delegate { });
            return queryCalls == 2;
        }
        catch
        {
            return false;
        }
    }

    private static bool RejectsEmptyReadbackAfterDeadline()
    {
        int queryCalls = 0;
        try
        {
            Gate014B1WindowsJobLauncher.TerminateAndObserveEmptyCore(
                delegate { queryCalls += 1; return queryCalls == 1 ? 1U : 0U; },
                delegate { return true; },
                delegate
                {
                    if (queryCalls < 2)
                    {
                        return 4999L;
                    }
                    return 5001L;
                },
                delegate { });
        }
        catch (TimeoutException)
        {
            return queryCalls == 2;
        }
        return false;
    }
}
