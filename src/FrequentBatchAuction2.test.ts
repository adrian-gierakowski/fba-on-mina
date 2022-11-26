import * as R from 'ramda';
import {
  commitmentKeyFromPrivateKey,
  FrequentBatchAuction,
  Order,
  phases,
} from './FrequentBatchAuction2';
import {
  isReady,
  shutdown,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  UInt32,
  Poseidon,
  MerkleMap,
  Int64,
} from 'snarkyjs';

/*
 * This file specifies how to test the `FrequentBatchAuction` example smart contract. It is safe to delete this file and replace
 * with your own tests.
 *
 * See https://docs.minaprotocol.com/zkapps for more info.
 */

function createLocalBlockchain() {
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);
  return Local.testAccounts[0].privateKey;
}

async function localDeploy(
  zkAppInstance: FrequentBatchAuction,
  zkAppPrivatekey: PrivateKey,
  deployerAccount: PrivateKey
) {
  const txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkAppInstance.deploy({ zkappKey: zkAppPrivatekey });
    zkAppInstance.sign(zkAppPrivatekey);
  });
  await txn.send();
}

const getState = (instance: FrequentBatchAuction) => ({
  committedOrdersRoot: instance.committedOrdersRoot.get(),
});

describe('FrequentBatchAuction2', () => {
  let deployerAccount: PrivateKey;
  let zkAppAddress: PublicKey;
  let zkAppPrivateKey: PrivateKey;

  beforeEach(async () => {
    await isReady;
    deployerAccount = createLocalBlockchain();
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
  });

  afterAll(async () => {
    // `shutdown()` internally calls `process.exit()` which will exit the running Jest process early.
    // Specifying a timeout of 0 is a workaround to defer `shutdown()` until Jest is done running all tests.
    // This should be fixed with https://github.com/MinaProtocol/mina/issues/10943
    setTimeout(shutdown, 0);
  });

  type UserKeys = {
    privateKey: PrivateKey;
    key: Field;
  };

  const setup = async () => {
    const instance = new FrequentBatchAuction(zkAppAddress);
    await localDeploy(instance, zkAppPrivateKey, deployerAccount);

    const commitOrder = (
      committedOrders: MerkleMap,
      order: Order,
      { key, privateKey }: UserKeys
    ) => {
      const witness = committedOrders.getWitness(key);
      return Mina.transaction(deployerAccount, () => {
        instance.commitOrder(privateKey, order, witness);
        instance.sign(zkAppPrivateKey);
      })
        .then((txn) => txn.send())
        .then(() => {
          // Update committedOrders MerkleMap so that it matches
          // the committedOrdersRoot on the contract
          committedOrders.set(key, order.getCommitment());
        });
    };

    const revealOrder = (
      committedOrders: MerkleMap,
      order: Order,
      { key, privateKey }: UserKeys
    ) => {
      const witness = committedOrders.getWitness(key);
      return Mina.transaction(deployerAccount, () => {
        instance.revealOrder(privateKey, order, witness);
        instance.sign(zkAppPrivateKey);
      }).then((txn) => txn.send());
    };

    return { instance, commitOrder, revealOrder };
  };

  const makeUserKeys = (): UserKeys => {
    const privateKey = PrivateKey.random();
    const key = commitmentKeyFromPrivateKey(privateKey);

    return { privateKey, key };
  };

  const setupWithUsers = async (usersCount: number) => {
    const committedOrders = new MerkleMap();
    const userKeys = R.times(makeUserKeys, usersCount);

    return { ...(await setup()), committedOrders, userKeys };
  };

  it('generates and deploys the `FrequentBatchAuction` smart contract', async () => {
    const { instance } = await setup();
    const state = getState(instance);
    expect(state).toEqual({
      committedOrdersRoot: new MerkleMap().getRoot(),
    });
  });

  describe('commitOrder', () => {
    it('adds valid order commitment to committedOrdersRoot and emits an event', async () => {
      const { instance, commitOrder, userKeys, committedOrders } =
        await setupWithUsers(1);

      const order = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(-2),
      });

      await commitOrder(committedOrders, order, userKeys[0]);
      expect(instance.committedOrdersRoot.get()).toEqual(
        committedOrders.getRoot()
      );

      const events = await instance.fetchEvents();

      expect(events).toHaveLength(1);

      expect(events[0]).toEqual({
        type: 'OrderCommitted',
        event: new instance.events.OrderCommitted({
          key: userKeys[0].key,
          orderCommitment: order.getCommitment(),
        }),
      });
    });

    it('does not allow to overwrite commitment once set', async () => {
      const { instance, userKeys, committedOrders, commitOrder } =
        await setupWithUsers(1);

      const order = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(-2),
      });

      await commitOrder(committedOrders, order, userKeys[0]);

      // Try with the same order again.
      // TODO: can we make commitOrder idempotent and remove this assert?
      await expect(() =>
        commitOrder(committedOrders, order, userKeys[0])
      ).rejects.toThrow('invalid commitmentWitness');

      // Try with different order
      const order2 = new Order({
        amountA: Int64.from(2),
        amountB: Int64.from(-3),
      });

      await expect(() =>
        commitOrder(committedOrders, order, userKeys[0])
      ).rejects.toThrow('invalid commitmentWitness');
    });

    it('rejects invalid order', async () => {
      const { instance, userKeys, committedOrders, commitOrder } =
        await setupWithUsers(1);

      const order1 = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(1),
      });

      await expect(() =>
        commitOrder(committedOrders, order1, userKeys[0])
      ).rejects.toThrow(
        'invalid Order: amountA and amountB need to be of opposite sign'
      );

      const order2 = new Order({
        amountA: Int64.from(-1),
        amountB: Int64.from(-2),
      });

      await expect(() =>
        commitOrder(committedOrders, order2, userKeys[0])
      ).rejects.toThrow(
        'invalid Order: amountA and amountB need to be of opposite sign'
      );
    });

    it('allows commitments from multiple users', async () => {
      const { instance, userKeys, committedOrders, commitOrder } =
        await setupWithUsers(3);
      const emtyCommitmentValue = Field(0);

      const order = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(-2),
      });

      await commitOrder(committedOrders, order, userKeys[0]);
      expect(instance.committedOrdersRoot.get()).toEqual(
        committedOrders.getRoot()
      );

      await commitOrder(committedOrders, order, userKeys[1]);
      expect(instance.committedOrdersRoot.get()).toEqual(
        committedOrders.getRoot()
      );

      const order2 = new Order({
        amountA: Int64.from(4),
        amountB: Int64.from(-1),
      });
      expect(instance.committedOrdersRoot.get()).toEqual(
        committedOrders.getRoot()
      );

      await commitOrder(committedOrders, order2, userKeys[2]);
    });
  });

  describe('revealOrder', () => {
    it('verifies order against an earlier commitment and emits event', async () => {
      const { instance, commitOrder, revealOrder, userKeys, committedOrders } =
        await setupWithUsers(1);

      const order = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(-2),
      });

      await commitOrder(committedOrders, order, userKeys[0]);
      await revealOrder(committedOrders, order, userKeys[0]);

      const events = await instance.fetchEvents();

      expect(events).toHaveLength(2);

      expect(events[1]).toEqual({
        type: 'OrderRevealed',
        event: new instance.events.OrderRevealed({
          key: userKeys[0].key,
          order,
        }),
      });
    });

    it('rejects transaction of no commitment was made for given key', async () => {
      const { instance, commitOrder, revealOrder, userKeys, committedOrders } =
        await setupWithUsers(1);

      const order = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(-2),
      });

      await expect(revealOrder(committedOrders, order, userKeys[0]))
        // TODO: can we have a nice message here?
        .rejects.toThrow()

      expect(await instance.fetchEvents()).toHaveLength(0)
    });

    it('rejects transaction if order does not match initial commitment', async () => {
      const { instance, commitOrder, revealOrder, userKeys, committedOrders } =
        await setupWithUsers(1);

      const committedOrder = new Order({
        amountA: Int64.from(1),
        amountB: Int64.from(-2),
      });

      await commitOrder(committedOrders, committedOrder, userKeys[0]);

      const revealedOrder = new Order({
        amountA: Int64.from(2),
        amountB: Int64.from(-2),
      });

      await expect(revealOrder(committedOrders, revealedOrder, userKeys[0]))
        // TODO: can we have a nice message here?
        .rejects.toThrow()

      expect(await instance.fetchEvents()).toHaveLength(1)
    });
  });
});
