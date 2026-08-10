import type { CredentialValidators, ProviderExecutors, ProviderProxyExecutor } from "../../core/types.ts";
import type { MymindActionContext } from "./runtime.ts";

import {
  defineProviderExecutors,
  defineProviderProxy,
  providerProxyEndpointPrefixes,
  requireCustomCredential,
} from "../provider-runtime.ts";
import {
  applyMymindRequestHeaders,
  mymindActionHandlers,
  mymindApiBaseUrl,
  mymindProxyEndpointPrefixes,
  readMymindCredential,
  validateMymindCredential,
} from "./runtime.ts";

const service = "mymind";

export const executors: ProviderExecutors = defineProviderExecutors<MymindActionContext>({
  service,
  handlers: mymindActionHandlers,
  // The mymind host is a literal owned by this module, never credential input.
  skipDnsValidation: true,
  async createContext(context, fetcher) {
    const credential = await requireCustomCredential(context, service);
    return {
      credential: readMymindCredential(credential.values),
      fetcher,
      transitFiles: context.transitFiles,
      signal: context.signal,
    };
  },
});

export const proxy: ProviderProxyExecutor = defineProviderProxy({
  service,
  baseUrl: mymindApiBaseUrl,
  auth: { type: "none" },
  skipDnsValidation: true,
  allowedEndpoint: providerProxyEndpointPrefixes(...mymindProxyEndpointPrefixes),
  async customizeRequest({ context, headers }) {
    const credential = await requireCustomCredential(context, service);
    applyMymindRequestHeaders(readMymindCredential(credential.values), headers);
  },
});

export const credentialValidators: CredentialValidators = {
  customCredential(input, { fetcher, signal }) {
    return validateMymindCredential(input.values, fetcher, signal);
  },
};
