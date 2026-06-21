// Links to public on-chain explorers, mirroring the backend's _suiscan helper so the UI
// surfaces the same verifiable artifacts (escrow object, lock/release tx, Walrus blob).

const SUISCAN = "https://suiscan.xyz/testnet";

export const suiscan = {
  tx: (d: string) => `${SUISCAN}/tx/${d}`,
  object: (id: string) => `${SUISCAN}/object/${id}`,
  account: (a: string) => `${SUISCAN}/account/${a}`,
};

/** Public Walrus aggregator URL for a stored manifest blob. */
export const walrusBlob = (blobId: string) =>
  `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;

export const short = (s: string, head = 8, tail = 6) =>
  s.length > head + tail + 1 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
