; Bytefry — Inno Setup 6 script (per-user install, no elevation).
; Compile with desktop/build.ps1 -Installer, or directly:
;   ISCC.exe /DMyAppVersion=0.1.2 /DSourceDir=..\dist\portable /DOutDir=..\dist\installer MemeFryer.iss
;
; The script file keeps its pre-rename name; the product it builds, installs and uninstalls is Bytefry.

#define MyAppName "Bytefry"
#define MyAppExeName "Bytefry.exe"
#define MyAppPublisher "nathwn12"

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
; Must match the published payload (build.ps1 passes x64compatible or arm64).
#ifndef MyArch
  #define MyArch "x64compatible"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\portable"
#endif
#ifndef OutDir
  #define OutDir "..\dist\installer"
#endif
; Setup.exe, the Apps & Features entry and the shortcuts take this icon (16-256 px).
; build.ps1 passes an absolute /DIconFile.
#ifndef IconFile
  #define IconFile "..\MemeFryer.Desktop\Assets\MemeFryer.ico"
#endif

[Setup]
; The AppId is the identity Windows uses for upgrade and uninstall, and it is deliberately unchanged
; by the product rename. Keeping it means an existing install is recognised as the same product: an
; upgrade reuses the previous install directory and the Apps & Features entry is replaced, not
; duplicated. Changing it would leave the old install behind as a separate product.
AppId={{B4F1C8A2-5E3D-4A97-9C21-7D6E5F4A3B18}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppCopyright={#MyAppPublisher} — GPL-3.0-only
VersionInfoVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutDir}
OutputBaseFilename=Bytefry-{#MyAppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed={#MyArch}
ArchitecturesInstallIn64BitMode={#MyArch}
MinVersion=10.0
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile={#IconFile}
CloseApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent

; No [UninstallDelete] entry, on purpose. The only thing this product writes outside its own install
; directory is the WebView2 profile at %LOCALAPPDATA%\MemeFryer, which holds UI state, and the
; pre-rename build deleted that folder on uninstall. Uninstalling now leaves it in place — safe by
; default, and reinstalling finds the state it had. The folder name is unchanged from the pre-rename
; build so an upgrade never has to migrate it.
