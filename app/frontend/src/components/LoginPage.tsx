import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import WelcomeLogo from "./WelcomeLogo";

interface LoginPageProps {
  onLogin: (alias: string) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const { t } = useTranslation();
  const [alias, setAlias] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = alias.trim();
    if (trimmed) {
      onLogin(trimmed);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <WelcomeLogo />
        <h1 className="login-title">{t("login.title")}</h1>
        <input
          className="login-input"
          type="text"
          placeholder={t("login.placeholder")}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          autoFocus
          maxLength={50}
        />
        <button className="login-btn" type="submit" disabled={!alias.trim()}>
          {t("login.submit")}
        </button>
      </form>
    </div>
  );
}
