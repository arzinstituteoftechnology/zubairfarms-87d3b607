import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import {
  DEFAULT_PRINT_SETTINGS,
  loadPrintSettings,
  savePrintSettings,
  type PrintSettings,
} from "@/lib/printSettings";

const Settings = () => {
  const { role } = useAuth();
  const { t } = useTranslation();
  const [ps, setPs] = useState<PrintSettings>(() => loadPrintSettings());
  if (role !== "admin") return <div className="text-muted-foreground">{t("settings.admin_only")}</div>;

  const update = (k: keyof PrintSettings, v: number) => setPs((p) => ({ ...p, [k]: v }));
  const save = () => { savePrintSettings(ps); toast.success(t("common.saved")); };
  const reset = () => { setPs({ ...DEFAULT_PRINT_SETTINGS }); savePrintSettings({ ...DEFAULT_PRINT_SETTINGS }); toast.success(t("common.saved")); };

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
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Printer className="h-5 w-5" /> {t("settings.print")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("settings.print_hint")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("settings.print_top")}</Label>
              <Input type="number" step="1" value={ps.topMm} onChange={(e) => update("topMm", Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t("settings.print_top_hint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.print_margin")}</Label>
              <Input type="number" step="1" value={ps.pageMarginMm} onChange={(e) => update("pageMarginMm", Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t("settings.print_margin_hint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.print_header_space")}</Label>
              <Input type="number" step="1" value={ps.headerSpaceMm} onChange={(e) => update("headerSpaceMm", Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t("settings.print_header_space_hint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.print_font")}</Label>
              <Input type="number" step="1" value={ps.fontSizePx} onChange={(e) => update("fontSizePx", Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t("settings.print_font_hint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("settings.print_line_height")}</Label>
              <Input type="number" step="0.1" value={ps.lineHeight} onChange={(e) => update("lineHeight", Number(e.target.value))} />
              <p className="text-xs text-muted-foreground">{t("settings.print_line_height_hint")}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={save}>{t("common.save")}</Button>
            <Button variant="outline" onClick={reset}>{t("settings.reset_defaults")}</Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> {t("settings.test_print")}</Button>
          </div>
          <div className="print-area border rounded-md p-4 bg-card mt-4">
            <div className="text-center font-bold text-lg mb-2">{t("app.name")}</div>
            <div className="text-sm mb-2">{t("settings.print_preview_sample")}</div>
            <table className="w-full text-sm border-t">
              <thead><tr><th className="text-start py-1">#</th><th className="text-start">{t("common.name")}</th><th className="text-end">{t("common.amount")}</th></tr></thead>
              <tbody>
                <tr className="border-t"><td>1</td><td>Sample A</td><td className="text-end">1,200</td></tr>
                <tr className="border-t"><td>2</td><td>Sample B</td><td className="text-end">3,450</td></tr>
                <tr className="border-t"><td>3</td><td>Sample C</td><td className="text-end">980</td></tr>
              </tbody>
            </table>
          </div>
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