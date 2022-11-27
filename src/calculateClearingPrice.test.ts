import * as R from 'ramda';
import { Order, calculateClearingPrice } from './calculateClearingPrice';

type OrderAmounts = {
  amountA: number;
  amountB: number;
}

const getPrice = (o: OrderAmounts): number =>
  Math.abs(o.amountB / o.amountA);

describe('priceAlgo', () => {
  it('1', async () => {
    const buyOrders: ReadonlyArray<Order> = [
      {
        price: 292,
        size: 709000000000000,
      },
      {
        price: 292,
        size: 200000000000000,
      },
      {
        price: 253,
        size: 757000000000000,
      },
      {
        price: 174,
        size: 865000000000000,
      },
      {
        price: 92.7508120443,
        size: 10000000000,
      },
      {
        price: 97.0250727627,
        size: 10000000000,
      },
    ];

    const sellOrders: ReadonlyArray<Order> = [
      {
        price: 78,
        size: 1840000000000,
      },
      {
        price: 27,
        size: 970000000000,
      },
      {
        price: 7,
        size: 6700000000000,
      },
      {
        price: 96,
        size: 8780000000000,
      },
      {
        price: 97.7508120443,
        size: 10000000000,
      },
      {
        price: 102.0250727627,
        size: 10000000000,
      },
    ];

    const minTickSize = 0.01
    const result = calculateClearingPrice(buyOrders, sellOrders, minTickSize)

    console.log('result', result)
    expect(result).toEqual({
      clearingPrice: 138.24000000003252,
      volumeSettled: 2531000000000000,
      imbalance: -174400000595.5
    })
  });

  it('2', async () => {
    const orders = [
      { amountA: 10, amountB: -10 },
      { amountA: 11, amountB: -10 },
      { amountA: 12, amountB: -10 },
      { amountA: 13, amountB: -10 },
      { amountA: 14, amountB: -10 },
      { amountA: -16, amountB: 20 },
      { amountA: -18, amountB: 20 },
      { amountA: -20, amountB: 20 },
      { amountA: -22, amountB: 20 },
      { amountA: -23, amountB: 20 },
      { amountA: -24, amountB: 20 },
    ];

    const amountsToOrder = (a: OrderAmounts): Order => ({
      price: getPrice(a),
      size: Math.abs(a.amountA)
    })

    const [buyOrders, sellOrders] = R.compose(
      R.map(R.map(amountsToOrder)),
      R.partition(({ amountA }) => amountA > 0)
    )(orders)
    // const buyOrders: ReadonlyArray<Order> = [];

    // const sellOrders: ReadonlyArray<Order> = [
    // ];

    console.log('buyOrders', buyOrders)
    console.log('sellOrders', sellOrders)

    const minTickSize = 0.01
    const result = calculateClearingPrice(buyOrders, sellOrders, minTickSize)

    console.log('result', result)
    expect(result).toEqual({
      clearingPrice: 0.8695652173913043,
      volumeSettled: 21,
      imbalance: -19.869565217391305
    })
  });
});
