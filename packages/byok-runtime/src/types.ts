export type InstallArgs = {
  vscode: any;
  getActivate: () => unknown;
  setActivate: (next: unknown) => void;
};

export type ByokProviderType = "openai_compatible" | "openai_native" | "anthropic_native";
export type ByokFeatureFlagsMode = "safe" | "passthrough";

export type ByokProvider = {
  id: string;
  type: ByokProviderType;
  baseUrl: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  requestDefaults?: Record<string, any>;
};

export type ByokRoutingRule = {
  enabled?: boolean;
  providerId?: string;
  model?: string;
};

export type ByokRoutingV2 = {
  activeProviderId: string;
  rules?: Record<string, ByokRoutingRule>;
};

export type ByokConfigV2 = {
  version: 2;
  enabled?: boolean;
  proxy?: { baseUrl: string; featureFlagsMode?: ByokFeatureFlagsMode };
  providers: ByokProvider[];
  routing: ByokRoutingV2;
};

export type ByokProviderSecrets = {
  apiKey?: string;
  token?: string;
};

export type ByokResolvedProvider = ByokProvider & { secrets: ByokProviderSecrets };

export type ByokResolvedConfigV2 = Omit<ByokConfigV2, "providers" | "proxy"> & {
  providers: ByokResolvedProvider[];
  proxy: { baseUrl: string; token?: string; featureFlagsMode?: ByokFeatureFlagsMode };
};

export type ByokExportV2 = {
  version: 2;
  config: ByokConfigV2;
  secrets: { proxy: { token?: string | null }; providers: Record<string, { apiKey?: string | null; token?: string | null }> };
  meta: { exportedAt: string; redacted: boolean };
};
