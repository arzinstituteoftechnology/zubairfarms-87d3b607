import { useTranslation } from "react-i18next";
import { setLang, type Lang } from "@/i18n";
import { cn } from "@/lib/utils";

export const LanguageSwitcher = ({ className, ...rest }: { className?: string } & React.HTMLAttributes<HTMLDivElement>) => {
  const { i18n } = useTranslation();
  const cur = (i18n.language as Lang) || "en";
  const Btn = ({ v, label }: { v: Lang; label: string }) => (
    <button
      type="button"
      onClick={() => setLang(v)}
      className={cn(
        "px-2 py-1 text-xs rounded-md transition-colors",
        cur === v ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/70 hover:bg-sidebar-accent",
      )}
    >
      {label}
    </button>
  );
  return (
    <div
      role="group"
      aria-label={rest["aria-label"] ?? "Switch language"}
      className={cn("inline-flex items-center gap-1 rounded-md border border-sidebar-border p-0.5", className)}
      {...rest}
    >
      <Btn v="en" label="EN" />
      <Btn v="ur" label="اردو" />
    </div>
  );
};