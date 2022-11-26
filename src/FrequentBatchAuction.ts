import {
  Field,
  SmartContract,
  state,
  State,
  method,
  DeployArgs,
  Permissions,
  UInt32,
  Poseidon,
  Circuit,
} from 'snarkyjs';

export const phases = {
  committedOrderA: () => UInt32.from(0),
  committedOrderB: () => UInt32.from(1),
  revealedOrderA: () => UInt32.from(2),
  revealedOrderB: () => UInt32.from(3),
  settled: () => UInt32.from(4),
  canceled: () => UInt32.from(5),
};
/**
 */
export class FrequentBatchAuction extends SmartContract {
  @state(UInt32) phase = State<UInt32>();
  @state(Field) orderComitmentA = State<Field>();
  @state(Field) orderComitmentB = State<Field>();
  // partyAAmountSellX and partyBAmountBuyX represent amounts of asset X to be exchanged.
  // These are made known on contract initialization.
  @state(UInt32) partyAAmountSellX = State<UInt32>();
  @state(UInt32) partyBAmountBuyX = State<UInt32>();
  // partyAAmountBuyY and partyBAmountSellY represent amounts of asset Y to be exchanged.
  // Party A commits to partyAAmountBuyY on initialization.
  @state(UInt32) partyAAmountBuyY = State<UInt32>();
  // Party B commits to partyBAmountSellY in commitOrderB, which is the
  // first transaction following initialization.
  @state(UInt32) partyBAmountSellY = State<UInt32>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });
  }

  // Party A initialises the contract with a sell order, where:
  // partyAAmountSellX - specifies how much they want to sell of asset X
  // partyAAmountBuyY - specifies the minimum amount of Y they want to get in return
  // TODO: we need a way for party A to deposit and lock sufficient
  // amount of asset X (>= partyAAmountSellX) into the contract.
  @method initState(partyAAmountSellX: UInt32, partyAAmountBuyY: UInt32) {
    // Amounts of asset X to be exchanged are made public.
    this.partyAAmountSellX.set(partyAAmountSellX);
    this.partyBAmountBuyX.set(partyAAmountSellX);

    // partyAAmountBuyY is not revealed, therefore the price at which
    // party A wishes to sell asset X will not be known to the other party.
    this.partyAAmountBuyY.set(UInt32.zero);
    // however the commitment ensures that the price is fixed
    this.orderComitmentA.set(Poseidon.hash(partyAAmountBuyY.toFields()));

    // Can we leave these unitialised?
    this.partyBAmountSellY.set(UInt32.zero);
    this.orderComitmentB.set(new Field(0));

    this.phase.set(phases.committedOrderA());
  }

  // partyBAmountBuyX is fixed on initialisation, so we need a commitment
  // to partyBAmountSellY, which sets the price at which party B wants to
  // buy asset X.
  // TODO: at this point we need to ensure that party B has
  // sufficient balance of asset Y locked in the contract (>= partyBAmountSellY).
  @method commitOrderB(partyBAmountSellY: UInt32) {
    this.phase.assertEquals(phases.committedOrderA());

    this.orderComitmentB.set(Poseidon.hash(partyBAmountSellY.toFields()));

    this.phase.set(phases.committedOrderB());
  }

  // TODO: allow revealOrderA and revealOrderB to be executed in any order.

  // partyAAmountBuyY is secret so it needs to be revealed before orders
  // can be settled
  @method revealOrderA(partyAAmountBuyY: UInt32) {
    this.phase.assertEquals(phases.committedOrderB());

    const orderComitmentFromArgs = Poseidon.hash(partyAAmountBuyY.toFields());

    this.orderComitmentA.assertEquals(orderComitmentFromArgs);

    this.partyAAmountBuyY.set(partyAAmountBuyY);
    this.phase.set(phases.revealedOrderA());
  }

  // partyBAmountSellY is secret so it needs to be revealed before orders
  // can be settled
  @method revealOrderB(partyBAmountSellY: UInt32) {
    const phase = this.phase.get();
    this.phase.assertEquals(phase);
    phase.assertEquals(phases.revealedOrderA());

    const orderComitmentFromBrgs = Poseidon.hash(partyBAmountSellY.toFields());

    this.orderComitmentB.assertEquals(orderComitmentFromBrgs);

    this.partyBAmountSellY.set(partyBAmountSellY);
    // NOTE: we could settle immediately here, but for now
    // keeping settle as separate method for clarity.
    this.phase.set(phases.revealedOrderB());
  }

  // TODO: set max time interval within which revealOrderA|B need to be called
  // after commitOrderB is. If any of the parties does not reveal the order
  // whoever calls settle should be able to claim their funds locked for the
  // trade.
  @method settle() {
    const phase = this.phase.get();
    this.phase.assertEquals(phase);
    phase.assertEquals(phases.revealedOrderB());

    const partyAAmountBuyY = this.partyAAmountBuyY.get();
    const partyBAmountSellY = this.partyBAmountSellY.get();

    const ordersMatch = partyBAmountSellY.gte(partyAAmountBuyY);

    const { finalState, settlementAmount } = Circuit.if(
      ordersMatch,
      {
        finalState: phases.settled(),
        // Orders settles at average price.
        // This will make final partyBAmountSellY <= original partyBAmountSellY since
        // partyBAmountSellY >= partyAAmountBuyY. This is important since we can
        // amountSell can only be adjusted down, since if we adjusted
        // up, then the amount could exceed what's held by the contract
        // in escrow.
        settlementAmount: partyBAmountSellY.add(partyAAmountBuyY).div(2),
      },
      {
        finalState: phases.canceled(),
        // When finalState === canceled, partyAAmountBuyY and partyBAmountBuyX are
        // set to 0, as no assets which change hands.
        // partyAAmountSellX and partyBAmountSellY remain unchanged
        settlementAmount: UInt32.zero,
      }
    );

    this.phase.set(finalState);
    this.partyAAmountBuyY.set(settlementAmount);
    this.partyBAmountBuyX.set(settlementAmount);
  }
}
