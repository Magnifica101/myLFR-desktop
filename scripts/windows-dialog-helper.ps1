# Answers one native file dialog for the packaged smoke test.
#
# It does not use the keyboard or the clipboard. It finds the dialog window,
# writes the path into the dialog's own file or folder box, and clicks the
# dialog's own OK button, which are ordinary Win32 messages. That needs no focus,
# so nothing can be typed into the wrong window, and it works whatever else is on
# screen. (Keystrokes and the clipboard did not: they depend on the dialog being
# in front, and the folder picker ignored the final Enter.)
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [Parameter(Mandatory = $true)][ValidateSet('folder', 'open', 'save')][string]$Mode
)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class MyLfrDialog {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr dialog, int id);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wParam, string text);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

  static string ClassOf(IntPtr hwnd) {
    StringBuilder name = new StringBuilder(64);
    GetClassName(hwnd, name, name.Capacity);
    return name.ToString();
  }

  // Standard Windows file dialogs, and message boxes, are visible windows of class #32770.
  public static IntPtr[] Dialogs(uint processId) {
    List<IntPtr> found = new List<IntPtr>();
    EnumWindows(delegate (IntPtr hwnd, IntPtr lParam) {
      uint pid;
      GetWindowThreadProcessId(hwnd, out pid);
      if (pid == processId && IsWindowVisible(hwnd) && ClassOf(hwnd) == "#32770") found.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return found.ToArray();
  }

  // The "File name:" or "Folder:" box is a visible Edit control. Its id is 1152 in the
  // folder picker and 1148 (inside a combo box) in the open and save dialogs; 1001 is
  // the classic id. The address bar and search box are Edit controls too, but hidden
  // or on other ids.
  public static IntPtr FindNameBox(IntPtr dialog) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(dialog, delegate (IntPtr hwnd, IntPtr lParam) {
      if (ClassOf(hwnd) != "Edit" || !IsWindowVisible(hwnd)) return true;
      int id = GetDlgCtrlID(hwnd);
      if (id == 1152 || id == 1148 || id == 1001) { found = hwnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static bool SetText(IntPtr box, string text) { return SendMessage(box, 0x000C, IntPtr.Zero, text) != IntPtr.Zero; }

  // BM_CLICK, posted rather than sent, so a message box raised by the click cannot block this.
  public static bool Click(IntPtr dialog, int id) {
    IntPtr button = GetDlgItem(dialog, id);
    return button != IntPtr.Zero && PostMessage(button, 0x00F5, IntPtr.Zero, IntPtr.Zero);
  }

  // The "already exists, replace it?" prompt is a TaskDialog: its Yes button (id 6) is drawn by the
  // dialog itself, so there is no window to click. TDM_CLICK_BUTTON presses it; an ordinary
  // message box gets a normal button click instead.
  public static void AnswerYes(IntPtr prompt) {
    if (!Click(prompt, 6)) PostMessage(prompt, 0x0466, (IntPtr)6, IntPtr.Zero);
  }

  public static bool StillOpen(IntPtr hwnd) { return IsWindow(hwnd); }
}
'@

$app = Get-Process mylfr-desktop -ErrorAction Stop | Select-Object -First 1
$appId = [uint32]$app.Id

# The file dialog is the one with a file or folder box; a prompt on top of it has none.
$dialog = [IntPtr]::Zero
$box = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(20)
while ($box -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
  foreach ($candidate in [MyLfrDialog]::Dialogs($appId)) {
    $found = [MyLfrDialog]::FindNameBox($candidate)
    if ($found -ne [IntPtr]::Zero) { $dialog = $candidate; $box = $found; break }
  }
  if ($box -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 200 }
}
if ($dialog -eq [IntPtr]::Zero) { throw 'No file dialog with a file or folder box appeared.' }
Start-Sleep -Milliseconds 400
if (-not [MyLfrDialog]::SetText($box, $Path)) { throw 'Could not write the path into the file dialog.' }
Start-Sleep -Milliseconds 200
if (-not [MyLfrDialog]::Click($dialog, 1)) { throw 'The file dialog has no OK button this helper recognises.' }

# Wait for the dialog to close. A save dialog asks before replacing an existing
# file; that question is another dialog, and the answer here is always Yes.
$closeBy = (Get-Date).AddSeconds(15)
while ([MyLfrDialog]::StillOpen($dialog) -and (Get-Date) -lt $closeBy) {
  foreach ($other in [MyLfrDialog]::Dialogs($appId)) {
    if ($other -ne $dialog) { [MyLfrDialog]::AnswerYes($other) }
  }
  Start-Sleep -Milliseconds 200
}
if ([MyLfrDialog]::StillOpen($dialog)) { throw 'The file dialog did not close after the path was entered.' }
