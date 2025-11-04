import { useState } from "react";
import {
  ArrowLeft,
  User,
  Lock,
  CreditCard,
  Phone,
  ExternalLink,
} from "lucide-react";
import { useLocation } from "wouter";
import IPhoneFrame from "@/components/IPhoneFrame";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import IOSStatusBar from "@/components/IOSStatusBar";

export default function Settings() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [selectedIntegration, setSelectedIntegration] = useState<string>("");

  return (
    <IPhoneFrame>
      <div className="h-full flex flex-col bg-background">
        <IOSStatusBar />

        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1
            className="text-xl font-semibold text-foreground"
            data-testid="text-settings-title"
          >
            Settings
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto pb-6">
          <div className="p-4 space-y-4">
            <Card data-testid="card-account-settings">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Account Settings
                </CardTitle>
                <CardDescription>
                  Update your account information
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-foreground">
                    Username
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="Enter new username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    data-testid="input-username"
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label
                    htmlFor="current-password"
                    className="text-foreground flex items-center gap-2"
                  >
                    <Lock className="h-4 w-4" />
                    Change Password
                  </Label>
                  <Input
                    id="current-password"
                    type="password"
                    placeholder="Current password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    data-testid="input-current-password"
                  />
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    data-testid="input-new-password"
                  />
                </div>
                <Button className="w-full" data-testid="button-save-account">
                  Save Changes
                </Button>
              </CardContent>
            </Card>

            <Card data-testid="card-integrations">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Integrations
                </CardTitle>
                <CardDescription>Sync with your POS</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label
                    htmlFor="integration-select"
                    className="text-foreground"
                  >
                    Select Integration
                  </Label>
                  <Select
                    value={selectedIntegration}
                    onValueChange={setSelectedIntegration}
                  >
                    <SelectTrigger
                      id="integration-select"
                      data-testid="select-integration"
                    >
                      <SelectValue placeholder="Choose an integration..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="square">Square</SelectItem>
                      <SelectItem value="clover">Clover</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedIntegration === "square" && (
                  <>
                    <div className="flex items-center justify-between p-3 rounded-md border border-border bg-card hover-elevate">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                          <CreditCard className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div>
                          <p
                            className="font-medium text-foreground"
                            data-testid="text-square-title"
                          >
                            Square
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Payment processing
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="button-connect-square"
                      >
                        Connect
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Connect your Square account to process payments
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <Card data-testid="card-twilio-config">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5 text-primary" />
                  Business Phone Number
                </CardTitle>
                <CardDescription>
                  Your Twilio number for customer orders
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 rounded-md border border-border bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Phone className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">
                        Phone Number
                      </p>
                      <p
                        className="text-lg font-semibold text-foreground"
                        data-testid="text-twilio-number"
                      >
                        (313) 888-7397
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Need to change your number? Contact your administrator for assistance.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </IPhoneFrame>
  );
}
