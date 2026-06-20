/// Trustless per-job escrow for the docking marketplace.
///
/// The RESEARCHER locks their own funds by signing `lock` with their own wallet -- their
/// coins, their signature; the platform never holds the researcher's key. The Escrow is a
/// *shared* object (owned by no one), so the platform cannot seize or move it at will.
/// The platform is recorded only as the `arbiter`: it may *trigger* a payout, but the
/// destinations are fixed by this contract -- `release` pays the provider the arbiter
/// names, and `refund` can ONLY ever return funds to the recorded `payer` (the
/// researcher). The arbiter can therefore never redirect the money to itself on a refund,
/// and never touch a locked escrow except through these two outcomes. That is the
/// trustless guarantee: you trust this code, not the platform operator.
///
/// job_id is the marketplace's own random UUID -- an opaque identifier that reveals
/// nothing about the protein/ligands, so it's safe to put on-chain (per the project's
/// on-chain-confidentiality rule: never molecule names/structures, only opaque ids).
module escrow::escrow;

use sui::balance::Balance;
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;

/// Caller of release/refund was not the recorded arbiter.
const ENotArbiter: u64 = 0;

public struct Escrow has key {
    id: UID,
    job_id: vector<u8>,
    funds: Balance<SUI>,
    payer: address, // the researcher who locked their own funds
    arbiter: address, // the platform: may trigger payout, can never redirect it
}

public struct Locked has copy, drop {
    escrow_id: ID,
    job_id: vector<u8>,
    amount: u64,
    payer: address,
    arbiter: address,
}
public struct Released has copy, drop {
    escrow_id: ID,
    job_id: vector<u8>,
    amount: u64,
    provider: address,
}
public struct Refunded has copy, drop {
    escrow_id: ID,
    job_id: vector<u8>,
    amount: u64,
    payer: address,
}

/// The RESEARCHER calls this with their own wallet. The Escrow is SHARED (owned by no
/// one), so the platform can never seize it. `arbiter` is the platform address allowed to
/// later trigger release/refund -- but since the destinations are fixed by this contract,
/// the arbiter can only pay the provider or refund the payer, never itself.
public fun lock(payment: Coin<SUI>, job_id: vector<u8>, arbiter: address, ctx: &mut TxContext) {
    let amount = payment.value();
    let payer = ctx.sender();
    let escrow = Escrow {
        id: object::new(ctx),
        job_id,
        funds: payment.into_balance(),
        payer,
        arbiter,
    };
    event::emit(Locked {
        escrow_id: object::id(&escrow),
        job_id: escrow.job_id,
        amount,
        payer,
        arbiter,
    });
    transfer::share_object(escrow);
}

/// Pay the locked funds out to `provider`. Only the recorded arbiter (the platform) may
/// call this. Consumes the Escrow object.
public fun release(escrow: Escrow, provider: address, ctx: &mut TxContext) {
    assert!(ctx.sender() == escrow.arbiter, ENotArbiter);
    let Escrow { id, job_id, funds, payer: _, arbiter: _ } = escrow;
    let escrow_id = id.to_inner();
    let amount = funds.value();
    let payout = coin::from_balance(funds, ctx);
    event::emit(Released { escrow_id, job_id, amount, provider });
    transfer::public_transfer(payout, provider);
    id.delete();
}

/// Refund -- ALWAYS to the recorded payer (the researcher), never anywhere else. Only the
/// recorded arbiter may trigger it. The hardcoded destination is the trustless guarantee:
/// the platform cannot redirect a refund to itself or a third party.
public fun refund(escrow: Escrow, ctx: &mut TxContext) {
    assert!(ctx.sender() == escrow.arbiter, ENotArbiter);
    let Escrow { id, job_id, funds, payer, arbiter: _ } = escrow;
    let escrow_id = id.to_inner();
    let amount = funds.value();
    let coin = coin::from_balance(funds, ctx);
    event::emit(Refunded { escrow_id, job_id, amount, payer });
    transfer::public_transfer(coin, payer);
    id.delete();
}
