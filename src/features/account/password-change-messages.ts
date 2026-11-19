// Copy for changing the password in Settings → Account (shared by the action and the form).
export const PASSWORD_CHANGE_MESSAGES = {
  current: "Enter your current password.",
  wrongCurrent: "Your current password is not right.",
  same: "Choose a password different from your current one.",
  tooMany: "Too many tries. Wait 15 minutes, then try again.",
  done: "Password changed. You stay signed in here; other devices are signed out.",
} as const;
