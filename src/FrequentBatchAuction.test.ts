import { FrequentBatchAuction, phases } from './FrequentBatchAuction';
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
  deployerAccount: PrivateKey,
  partyAAmountSellX: UInt32,
  partyAAmountBuyY: UInt32
) {
  const txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    zkAppInstance.deploy({ zkappKey: zkAppPrivatekey });
    zkAppInstance.initState(partyAAmountSellX, partyAAmountBuyY);
    zkAppInstance.sign(zkAppPrivatekey);
  });
  await txn.send();
}

const getState = (instance: FrequentBatchAuction) => ({
  phase: instance.phase.get(),
  orderComitmentA: instance.orderComitmentA.get(),
  orderComitmentB: instance.orderComitmentB.get(),
  partyAAmountSellX: instance.partyAAmountSellX.get(),
  partyBAmountBuyX: instance.partyBAmountBuyX.get(),
  partyAAmountBuyY: instance.partyAAmountBuyY.get(),
  partyBAmountSellY: instance.partyBAmountSellY.get(),
});

describe('FrequentBatchAuction', () => {
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

  const setup = async ({
    partyAAmountSellX = UInt32.from(10),
    partyAAmountBuyY = UInt32.from(5),
  }: {
    partyAAmountSellX?: UInt32;
    partyAAmountBuyY?: UInt32;
  } = {}): Promise<{
    instance: FrequentBatchAuction;
    partyAAmountSellX: UInt32;
    partyAAmountBuyY: UInt32;
  }> => {
    const instance = new FrequentBatchAuction(zkAppAddress);
    await localDeploy(
      instance,
      zkAppPrivateKey,
      deployerAccount,
      partyAAmountSellX,
      partyAAmountBuyY
    );

    return { instance, partyAAmountSellX, partyAAmountBuyY };
  };

  it('generates and deploys the `FrequentBatchAuction` smart contract', async () => {
    const { instance, partyAAmountSellX, partyAAmountBuyY } = await setup();
    const orderComitmentA = Poseidon.hash(partyAAmountBuyY.toFields());

    expect(instance.phase.get()).toEqual(UInt32.zero);
    expect(instance.orderComitmentA.get()).toEqual(orderComitmentA);
    expect(instance.orderComitmentB.get()).toEqual(Field.zero);
    expect(instance.partyAAmountSellX.get()).toEqual(partyAAmountSellX);
    expect(instance.partyBAmountBuyX.get()).toEqual(partyAAmountSellX);
    expect(instance.partyAAmountBuyY.get()).toEqual(UInt32.zero);
    expect(instance.partyBAmountSellY.get()).toEqual(UInt32.zero);
  });

  const makeAndSendCommitOrderBTx = async (
    instance: FrequentBatchAuction,
    partyBAmountSellY = UInt32.from(4)
  ) => {
    const txn = await Mina.transaction(deployerAccount, () => {
      instance.commitOrderB(partyBAmountSellY);
      instance.sign(zkAppPrivateKey);
    });

    await txn.send();

    return { partyBAmountSellY };
  };

  describe('commitOrderB', () => {
    it('sets orderComitmentB and phase on success, leaving other state unchanged', async () => {
      const { instance } = await setup();

      const stateBefore = getState(instance);
      const { partyBAmountSellY } = await makeAndSendCommitOrderBTx(instance);
      const stateAfter = getState(instance);

      const expectedState = {
        ...stateBefore,
        phase: phases.committedOrderB(),
        orderComitmentB: Poseidon.hash(partyBAmountSellY.toFields()),
      };
      expect(stateAfter).toEqual(expectedState);
    });

    it('fails if called in the wrong phase', async () => {
      const { instance } = await setup();

      await makeAndSendCommitOrderBTx(instance);

      await expect(() => makeAndSendCommitOrderBTx(instance)).rejects.toThrow(
        'Account_app_state_precondition_unsatisfied'
      );
    });
  });

  describe('revealOrderA', () => {
    const makeAndSendTx = async (
      instance: FrequentBatchAuction,
      partyAAmountBuyY: UInt32
    ) => {
      const txn = await Mina.transaction(deployerAccount, () => {
        instance.revealOrderA(partyAAmountBuyY);
        instance.sign(zkAppPrivateKey);
      });

      await txn.send();
    };

    it('sets orderComitmentB and phase on success, leaving other state unchanged', async () => {
      const { instance, partyAAmountBuyY } = await setup();

      await makeAndSendCommitOrderBTx(instance);

      const stateBefore = getState(instance);
      await makeAndSendTx(instance, partyAAmountBuyY);
      const stateAfter = getState(instance);

      const expectedState = {
        ...stateBefore,
        phase: phases.revealedOrderA(),
        partyAAmountBuyY,
      };
      expect(stateAfter).toEqual(expectedState);
    });

    it('fails if called in the wrong phase', async () => {
      const { instance, partyAAmountBuyY } = await setup();

      await expect(() =>
        makeAndSendTx(instance, partyAAmountBuyY)
      ).rejects.toThrow('Account_app_state_precondition_unsatisfied');
    });
  });
});
