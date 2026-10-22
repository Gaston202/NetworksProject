@echo off
REM ============================================================
REM  Live server-side Wireshark capture from the LabServer VM
REM  Streams the server's enp0s8 interface (HTTP, port 80) over
REM  SSH into Wireshark on this laptop. Run in cmd.exe (this file)
REM  NOT PowerShell -- PowerShell corrupts the binary pcap stream.
REM
REM  Usage: double-click this file, or run  live-capture.cmd
REM  Stop:  close this window, or Ctrl+C.
REM ============================================================

set "WIRESHARK=C:\Program Files\Wireshark\Wireshark.exe"
set "VMUSER=ghass"
set "SSHPORT=2222"
set "IFACE=enp0s8"

echo Starting live capture from %VMUSER%@127.0.0.1:%SSHPORT% on %IFACE% ...
echo Leave this window open for the whole demo. Close it to stop capturing.
echo.

ssh -p %SSHPORT% %VMUSER%@127.0.0.1 "tcpdump -i %IFACE% -s0 -U -w - 'tcp port 80'" | "%WIRESHARK%" -k -i -
