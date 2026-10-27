/** 機密情報らしい文字列（04 §4.10 の D-14、07 §7.5 の B-06） */
export const SECRET_PATTERN =
  /(sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]+-----|AKIA[0-9A-Z]{16})/;
