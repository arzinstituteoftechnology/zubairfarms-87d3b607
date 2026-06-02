import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const Settings = () => {
  const { role } = useAuth();
  if (role !== "admin") return <div className="text-muted-foreground">Admin access required.</div>;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">App-wide configuration</p>
      </div>
      <Card className="max-w-md">
        <CardHeader><CardTitle>General</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">More settings coming soon.</CardContent>
      </Card>
    </div>
  );
};
export default Settings;