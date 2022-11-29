import { curry } from 'ramda';
import {
  arrayProp,
  Bool,
  Circuit,
  CircuitValue,
  DeployArgs,
  Field,
  Int64,
  MerkleMap,
  MerkleMapWitness,
  method,
  Permissions,
  Poseidon,
  PrivateKey,
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
  price: UInt64,
});

export class Order extends OrderBase {
  constructor(...args: ConstructorParameters<typeof OrderBase>) {
    super(...args);
  }

  getCommitment() {
    return Poseidon.hash(OrderBase.toFields(this));
  }
}

export class OrderWithKey extends Struct({
  order: Order,
  key: Field,
}) {}

const maxOrderCount = 10;

export class OrdersWithKeys extends CircuitValue {
  @arrayProp(OrderWithKey, maxOrderCount) orders: OrderWithKey[];

  constructor(orders: OrderWithKey[]) {
    super();
    this.orders = orders;
  }

  merkleMap(): MerkleMap {
    const map = new MerkleMap();

    for (const orderWithkey of this.orders) {
      map.set(orderWithkey.key, new Order(orderWithkey.order).getCommitment());
    }

    return map;
  }
}

export const commitmentKeyFromPrivateKey = (privateKey: PrivateKey): Field => {
  return Poseidon.hash(privateKey.toPublicKey().toFields());
};

/**
 */
export class FrequentBatchAuction extends SmartContract {
  events = {
    OrderCommitted: Struct({ key: Field, orderCommitment: Field }),
    OrderRevealed: Struct({ key: Field, order: Order }),
  };

  @state(Field) committedOrdersRoot = State<Field>();
  @state(UInt32) orderCount = State<UInt32>();

  deploy(args: DeployArgs) {
    super.deploy(args);
    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
    });

    this.committedOrdersRoot.set(new MerkleMap().getRoot());
    this.orderCount.set(UInt32.from(0));
  }

  assertAndGetOrderCount(): UInt32 {
    const orderCount = this.orderCount.get();
    this.orderCount.assertEquals(orderCount);
    return orderCount;
  }

  assertAndGetRoot(): Field {
    const currentRoot = this.committedOrdersRoot.get();
    this.committedOrdersRoot.assertEquals(currentRoot);
    return currentRoot;
  }

  @method initState() {}

  @method commitOrder(
    privateKey: PrivateKey,
    order: Order,
    commitmentWitness: MerkleMapWitness
  ) {
    const orderCount = this.assertAndGetOrderCount();
    orderCount.assertLte(UInt32.from(maxOrderCount));

    const currentRoot = this.assertAndGetRoot();

    const [rootBefore, key] = commitmentWitness.computeRootAndKey(Field(0));
    rootBefore.assertEquals(currentRoot, 'invalid commitmentWitness');

    const keyFromPrivateKey = commitmentKeyFromPrivateKey(privateKey);
    keyFromPrivateKey.assertEquals(key);

    const orderCommitment = order.getCommitment();
    const [newRoot, _] = commitmentWitness.computeRootAndKey(orderCommitment);

    this.committedOrdersRoot.set(newRoot);
    // Track number of committed orders.
    this.orderCount.set(orderCount.add(1));
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
    const currentRoot = this.assertAndGetRoot();

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

  @method calculateSettlementPrice(
    buyOrders: OrdersWithKeys,
    sellOrders: OrdersWithKeys
  ) {
    // Verify state.
    const currentRoot = this.assertAndGetRoot();
    const merkleMap = new MerkleMap();
    const addOrderToMap = (o: OrderWithKey) =>
      merkleMap.set(o.key, new Order(o.order).getCommitment());
    const allOrder = buyOrders.orders.concat(sellOrders.orders);
    allOrder.forEach(addOrderToMap);

    const root = merkleMap.getRoot();
    currentRoot.assertEquals(root);

    const isBuyOrder = (o: Order): Bool => o.amountA.isPositive();
    const assertIsBuyOrder = (o: Order) => isBuyOrder(o).assertEquals(true);
    const assertIsSellOrder = (o: Order) => isBuyOrder(o).assertEquals(false);

    buyOrders.orders.forEach((o) => assertIsBuyOrder(new Order(o.order)));
    sellOrders.orders.forEach((o) => assertIsSellOrder(new Order(o.order)));

    const sortedOrders = allOrder.sort((a, b) => {
      const pricesEqual = a.order.price.equals(b.order.price)

      if (Bool(pricesEqual).toBoolean()) return 0
      const aIsGreater = a.order.price.gt(b.order.price)
      return Bool(aIsGreater).toBoolean()
        ? 1
        : -1
    })

    console.log('sorted prices', sortedOrders.map(o => o.order.price.toString()))

    // Verify that orders are sorted.
    const minPrice = UInt64.from(0)
    sortedOrders.reduce(
      (prevPrice, order) => {
        // console.log('price', price.toString())
        order.order.price.assertGte(prevPrice)
        return order.order.price
      },
      minPrice
    )
  }
}
