/** @file Select the language for this device without changing the household's settings. */

import { useLanguageChoice, useWords } from "../locale";

export function LanguageSelect() {
  const [choice, choose] = useLanguageChoice();
  const t = useWords();
  return (
    <label className="language-select">
      {t("Language")}
      <select
        value={choice}
        onChange={({ currentTarget: { value } }) => {
          if (value === "en" || value === "zh-Hans" || value === "auto") choose(value);
        }}
      >
        <option value="auto">{t("Browser language")}</option>
        <option value="en" lang="en">
          English
        </option>
        <option value="zh-Hans" lang="zh-Hans">
          简体中文
        </option>
      </select>
    </label>
  );
}
