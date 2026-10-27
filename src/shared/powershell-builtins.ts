/** Load the bundled Utility cmdlets before a PATH executable can shadow autoload. */
export const POWERSHELL_BUILTINS_PREFIX = "Microsoft.PowerShell.Core\\Import-Module ([IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop;\n";
