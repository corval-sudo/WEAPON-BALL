// web/src/lib/wagmi.ts
import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected(),
    coinbaseWallet({ appName: "WORBZ Arena" }),
  ],
  transports: {
    [base.id]: http(),
  },
});
