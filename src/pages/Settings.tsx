import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const Settings = () => {
  const { role } = useAuth();
  const { t } = useTranslation();
  if (role !== "admin") return <div className="text-muted-foreground">{t("settings.admin_only")}</div>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>
      <Card className="max-w-md">
        <CardHeader><CardTitle>{t("settings.language")}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("settings.language_hint")}</p>
          <LanguageSwitcher />
        </CardContent>
      </Card>
      <Card className="max-w-md">
        <CardHeader><CardTitle>{t("settings.general")}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("settings.more_soon")}</CardContent>
      </Card>
    </div>
  );
};
export default Settings;