import {
  Bool,
  Circuit,
  DeployArgs,
  Field,
  Int64,
  MerkleMap,
  MerkleMapWitness,
  MerkleTree,
  MerkleWitness,
  method,
  Permissions,
  Poseidon,
  PrivateKey,
  PublicKey,
  Sign,
  SmartContract,
  state,
  State,
  Struct,
  UInt32,
  UInt64,
} from 'snarkyjs';

export const phases = {
  commit: () => UInt32.from(0),
  reveal: () => UInt32.from(1),
  settle: () => UInt32.from(2),
};

const OrderBase = Struct({
  amountA: Int64,
  amountB: Int64,
});

export class Order extends OrderBase {
  constructor(...args: ConstructorParameters<typeof OrderBase>) {
    super(...args);
    // this.assertValid();
  }

  assertValid() {
    const { amountA, amountB } = this;
    Bool(amountA.sgn.mul(amountB.sgn).isPositive()).assertEquals(
      false,
      'invalid Order: amountA and amountB need to be of opposite sign'
    );
  }

  getCommitment() {
    return Poseidon.hash(OrderBase.toFields(this));
  }
}

export const commitmentKeyFromPrivateKey = (privateKey: PrivateKey): Field => {
  return Poseidon.hash(
    privateKey.toPublicKey().toFields()
  );
}
// const OrderCommittedEvent =
// const OrderRevealedEvent =

/**
 */
export class FrequentBatchAuction extends SmartContract {
  events = {
    OrderCommitted: Struct({ key: Field, orderCommitment: Field }),
    OrderRevealed: Struct({ key: Field, order: Order }),
  };

  @state(Field) committedOrdersRoot = State<Field>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });

    this.committedOrdersRoot.set(new MerkleMap().getRoot());
  }

  @method initState() {}

  @method commitOrder(
    privateKey: PrivateKey,
    order: Order,
    commitmentWitness: MerkleMapWitness
  ) {
    // Make sure order is valid
    order.assertValid();

    // check the initial state matches what we expect
    const currentRoot = this.committedOrdersRoot.get();
    this.committedOrdersRoot.assertEquals(currentRoot);

    const [rootBefore, key] = commitmentWitness.computeRootAndKey(Field(0));
    rootBefore.assertEquals(currentRoot, 'invalid commitmentWitness');

    const keyFromPrivateKey = commitmentKeyFromPrivateKey(privateKey)
    keyFromPrivateKey.assertEquals(key);

    const orderCommitment = order.getCommitment();
    const [newRoot, _] = commitmentWitness.computeRootAndKey(orderCommitment);

    this.committedOrdersRoot.set(newRoot);
    this.emitEvent(
      'OrderCommitted',
      new this.events.OrderCommitted({
        key,
        orderCommitment,
      })
    );
  }

  @method revealOrder(
    privateKey: PrivateKey,
    order: Order,
    commitmentWitness: MerkleMapWitness
  ) {
    // check the initial state matches what we expect
    const currentRoot = this.committedOrdersRoot.get();
    this.committedOrdersRoot.assertEquals(currentRoot);

    const orderCommitment = order.getCommitment();

    const [rootBefore, key] =
      commitmentWitness.computeRootAndKey(orderCommitment);

    rootBefore.assertEquals(currentRoot);

    const keyFromPrivateKey = Poseidon.hash(
      privateKey.toPublicKey().toFields()
    );
    keyFromPrivateKey.assertEquals(key);

    this.emitEvent(
      'OrderRevealed',
      new this.events.OrderRevealed({
        key,
        order,
      })
    );
  }
}
