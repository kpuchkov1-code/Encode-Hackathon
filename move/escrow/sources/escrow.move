/// Custodial per-job escrow for the docking marketplace.
///
/// Researchers sign up with email only (no wallet), so for this slice the *platform*
/// is the sole custodian: a single platform keypair calls all three entry functions.
/// `lock` parks a Coin<SUI> inside an Escrow object owned by the platform; on a verified
/// docking result `release` pays the provider's address; on failure/abandonment `refund`
/// returns the funds to the platform. Making the escrow object platform-owned (not
/// shared) means only the platform can ever move it, and avoids consensus ordering cost.
///
/// job_id is the marketplace's own random UUID -- an opaque identifier that reveals
/// nothing about the protein/ligands, so it's safe to put on-chain (per the project's
/// on-chain-confidentiality rule: never molecule names/structures, only opaque ids).
module escrow::escrow;

use sui::balance::Balance;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

public struct Escrow has key, store {
    id: UID,
    job_id: vector<u8>,
    funds: Balance<SUI>,
    platform: address,
}

public struct Locked has copy, drop { escrow_id: ID, job_id: vector<u8>, amount: u64 }
public struct Released has copy, drop {
    escrow_id: ID,
    job_id: vector<u8>,
    amount: u64,
    provider: address,
}
public struct Refunded has copy, drop { escrow_id: ID, job_id: vector<u8>, amount: u64 }

/// Lock `payment` for `job_id`. The Escrow object is transferred to the caller (the
/// platform), so only the platform can later release or refund it.
public fun lock(payment: Coin<SUI>, job_id: vector<u8>, ctx: &mut TxContext) {
    let amount = payment.value();
    let sender = ctx.sender();
    let escrow = Escrow {
        id: object::new(ctx),
        job_id,
        funds: payment.into_balance(),
        platform: sender,
    };
    event::emit(Locked { escrow_id: object::id(&escrow), job_id: escrow.job_id, amount });
    transfer::transfer(escrow, sender);
}

/// Pay the locked funds out to `provider`. Consumes the Escrow object.
public fun release(escrow: Escrow, provider: address, ctx: &mut TxContext) {
    let Escrow { id, job_id, funds, platform: _ } = escrow;
    let escrow_id = id.to_inner();
    let amount = funds.value();
    let payout = coin::from_balance(funds, ctx);
    event::emit(Released { escrow_id, job_id, amount, provider });
    transfer::public_transfer(payout, provider);
    id.delete();
}

/// Return the locked funds to the platform. Consumes the Escrow object.
public fun refund(escrow: Escrow, ctx: &mut TxContext) {
    let Escrow { id, job_id, funds, platform } = escrow;
    let escrow_id = id.to_inner();
    let amount = funds.value();
    let coin = coin::from_balance(funds, ctx);
    event::emit(Refunded { escrow_id, job_id, amount });
    transfer::public_transfer(coin, platform);
    id.delete();
}
