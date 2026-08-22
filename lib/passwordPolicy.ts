export const ACCOUNT_PASSWORD_MIN_LENGTH = 8;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 72;

export function isStrongAccountPassword(value: string): boolean {
  return value.length >= ACCOUNT_PASSWORD_MIN_LENGTH
    && value.length <= ACCOUNT_PASSWORD_MAX_LENGTH
    && /^[\x21-\x7e]+$/.test(value)
    && /[A-Za-z]/.test(value)
    && /\d/.test(value);
}

export function isLegacyPhonePin(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function isAcceptedAccountLoginPassword(value: string): boolean {
  return isLegacyPhonePin(value) || isStrongAccountPassword(value);
}

export function accountPasswordRequirement(): string {
  return "8–72 位，至少包含一个英文字母和一个数字；可使用大小写字母与特殊符号。";
}
