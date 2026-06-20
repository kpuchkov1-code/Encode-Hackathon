/// COMPUTE -- the marketplace's fungible compute-unit token.
///
/// One COMPUTE represents one abstract unit of docking compute. Providers list asks on a
/// DeepBook COMPUTE/SUI pool ("I'll sell N COMPUTE at price P SUI"), and the control plane
/// reads that pool's price as the live market rate it quotes researchers. The token is
/// deliberately generic: it never encodes a job, a protein, or a ligand, so the public
/// order book reveals only that *some* compute was bought/sold, never what was computed.
module compute_token::compute;

use sui::coin::{Self, TreasuryCap};

/// One-time witness: name matches the module, uppercased, per Sui's coin convention.
public struct COMPUTE has drop {}

/// On publish, create the currency and hand the treasury cap to the publisher so the
/// platform can mint the supply it needs to seed liquidity / pay providers in COMPUTE.
fun init(witness: COMPUTE, ctx: &mut TxContext) {
    let (treasury, metadata) = coin::create_currency(
        witness,
        6,                       // decimals (scalar 1e6, matching DEEP/DBUSDC on DeepBook)
        b"COMPUTE",
        b"Docking Compute Unit",
        b"Fungible compute-unit for the decentralized docking marketplace; priced on DeepBook.",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::public_transfer(treasury, ctx.sender());
}

/// Mint `amount` (in base units, 1e6 = 1 COMPUTE) to `recipient`. Treasury-cap gated, so
/// only the holder (the platform) can create supply.
public fun mint(cap: &mut TreasuryCap<COMPUTE>, amount: u64, recipient: address, ctx: &mut TxContext) {
    let c = coin::mint(cap, amount, ctx);
    transfer::public_transfer(c, recipient);
}
