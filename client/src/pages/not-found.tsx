import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4 border-destructive/50 bg-destructive/5 backdrop-blur-sm">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 text-destructive items-center justify-center">
            <AlertTriangle className="h-12 w-12 animate-pulse" />
          </div>

          <h1 className="text-2xl font-bold text-center text-foreground font-mono mb-2">
            404 SYSTEM ERROR
          </h1>
          
          <p className="mt-4 text-center text-muted-foreground font-mono text-sm">
            RESOURCE_LOCATOR_FAILURE: The requested pathway could not be resolved by the navigation subsystem.
          </p>

          <div className="mt-8 flex justify-center">
            <Link href="/">
              <Button variant="outline" className="font-mono border-primary/50 text-primary hover:bg-primary/10">
                RETURN TO DASHBOARD
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
