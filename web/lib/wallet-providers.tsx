"use client";

/*
  Client-only provider stack for the real Sui wallet flow. Wraps the app in:
   - QueryClientProvider  (react-query, required by dapp-kit's hooks)
   - SuiClientProvider    (a SuiClient pinned to testnet — the network our escrow lives on)
   - WalletProvider       (wallet-standard discovery + connect, autoConnect on)

  Everything here is "use client"; dapp-kit touches window/wallet extensions and must not run
  during SSR. The escrow package/network are testnet constants (also served by GET /chain/info).
*/

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SuiClientProvider,
  WalletProvider,
  createNetworkConfig,
} from "@mysten/dapp-kit";
import "@mysten/dapp-kit/dist/index.css";

// Fullnode URLs (getFullnodeUrl was removed from @mysten/sui v2). The escrow lives on
// testnet, which GET /chain/info also reports.
const { networkConfig } = createNetworkConfig({
  testnet: { url: "https://fullnode.testnet.sui.io:443", network: "testnet" },
  mainnet: { url: "https://fullnode.mainnet.sui.io:443", network: "mainnet" },
});

const queryClient = new QueryClient();

export function WalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networkConfig} defaultNetwork="testnet">
        <WalletProvider autoConnect>{children}</WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  );
}
