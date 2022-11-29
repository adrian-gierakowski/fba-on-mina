// Adapted from: https://github.com/MEVProof/Contracts/blob/40ae7b29979ebfcdcda93de36df807e7b317bb0e/test/Utils.js#L190-L304
import * as R from 'ramda';
import FP from 'lodash/fp';
import { Ord } from 'ramda';

export type Order = Readonly<{
  price: number;
  size: number;
}>;

type VolumesByPrice = Record<string, number>;

const ordersToVolumesByPricePoint = (
  orders: ReadonlyArray<Order>
): VolumesByPrice =>
  R.pipe(FP.groupBy('price'), FP.mapValues(FP.sumBy('size')))(orders);

const cumulativeVolumesByPrice = (
  allPrices: ReadonlyArray<number>,
  orders: ReadonlyArray<Order>
): VolumesByPrice => {
  const volumesFromOrdersByPrice = ordersToVolumesByPricePoint(orders);
  const prices = R.scan(
    (acc: [number, number], price) => {
      const cummulativeVolume = acc[1];
      const volumeAtPrice = volumesFromOrdersByPrice[price.toString()] ?? 0;
      return [price, volumeAtPrice + cummulativeVolume] as const;
    },
    [0, 0],
    allPrices
  );

  return R.fromPairs(prices);
};

const sumVolumesFromOrdersWithPricePredicate =
  (pred: (price: number) => boolean) => (orders: ReadonlyArray<Order>) =>
    FP.sumBy(
      'size',
      R.filter((o) => pred(o.price), orders)
    ) ?? 0;

const clearingVolumeAtPrice =
  (buyVolumes: VolumesByPrice, sellVolumes: VolumesByPrice) =>
  (price: number) =>
    Math.min(buyVolumes[price] ?? 0, (sellVolumes[price] ?? 0) * price);

export const calculateClearingPrice = (
  buyOrders: ReadonlyArray<Order>,
  sellOrders: ReadonlyArray<Order>,
  minTickSize: number
) => {
  const numBuys = buyOrders.length;
  const numSells = sellOrders.length;

  const allOrders = FP.concat(buyOrders, sellOrders);

  const prices = R.pipe(
    R.map((x: Order) => x.price),
    R.uniq,
    R.sortBy(R.identity)
  )(allOrders);

  console.log('prices', prices);

  const buyVolumes = cumulativeVolumesByPrice(R.reverse(prices), buyOrders);
  const sellVolumes = cumulativeVolumesByPrice(prices, sellOrders);

  // console.log(
  //   'buyVolumes',
  //   FP.sortBy(
  //     0,
  //     R.map(([p, v]) => [parseFloat(p), v], R.toPairs(buyVolumes))
  //   )
  // );
  // console.log(
  //   'sellVolumes',
  //   FP.sortBy(
  //     0,
  //     R.map(([p, v]) => [parseFloat(p), v], R.toPairs(sellVolumes))
  //   )
  // );

  const getClearingVolume = clearingVolumeAtPrice(buyVolumes, sellVolumes);

  let [clearingPrice, maxVolume] = R.reduce(
    (acc: [number, number], price: number) => {
      const volumeAtPreviousPrice = acc[1];
      const volumeAtPrice = getClearingVolume(price);
      return volumeAtPrice > volumeAtPreviousPrice
        ? [price, volumeAtPrice]
        : acc;
    },
    [-1, 0],
    prices
  );

  const imbalances = R.fromPairs(
    R.map(
      (price) => [price, buyVolumes[price] - sellVolumes[price] * price],
      prices
    )
  );

  console.log('imbalances', imbalances);

  let imbalanceAtClearingPrice = imbalances[clearingPrice];

  let buyVolumeFinal = 0;
  let sellVolumeFinal = 0;

  const buyOrdersAboveClearingPrice = R.filter(
    (o) => o.price > clearingPrice,
    buyOrders
  );

  if (imbalanceAtClearingPrice > 0) {
    buyVolumeFinal += sumVolumesFromOrdersWithPricePredicate(
      (price) => price > clearingPrice
    )(buyOrders);

    sellVolumeFinal += sumVolumesFromOrdersWithPricePredicate(
      (price) => price <= clearingPrice
    )(sellOrders);

    const upperbound = prices[prices.indexOf(clearingPrice) + 1];
    let newImbalance =
      buyVolumeFinal - sellVolumeFinal * (clearingPrice + minTickSize);

    while (
      maxVolume ===
        Math.min(
          buyVolumeFinal,
          sellVolumeFinal * (clearingPrice + minTickSize)
        ) &&
      Math.abs(newImbalance) < Math.abs(imbalanceAtClearingPrice) &&
      clearingPrice + minTickSize < upperbound
    ) {
      clearingPrice += minTickSize;
      imbalanceAtClearingPrice = newImbalance;
      newImbalance =
        buyVolumeFinal - sellVolumeFinal * (clearingPrice + minTickSize);
    }
  } else {
    buyVolumeFinal += sumVolumesFromOrdersWithPricePredicate(
      (price) => price >= clearingPrice
    )(buyOrders);

    sellVolumeFinal += sumVolumesFromOrdersWithPricePredicate(
      (price) => price < clearingPrice
    )(sellOrders);

    const lowerbound = prices[prices.indexOf(clearingPrice) - 1];
    let newImbalance =
      buyVolumeFinal - sellVolumeFinal * (clearingPrice - minTickSize);

    while (
      maxVolume ===
        Math.min(
          buyVolumeFinal,
          sellVolumeFinal * (clearingPrice - minTickSize)
        ) &&
      Math.abs(newImbalance) < Math.abs(imbalanceAtClearingPrice) &&
      clearingPrice - minTickSize > lowerbound
    ) {
      clearingPrice -= minTickSize;
      imbalanceAtClearingPrice = newImbalance;
      newImbalance =
        buyVolumeFinal - sellVolumeFinal * (clearingPrice - minTickSize);
    }
  }

  return {
    clearingPrice: clearingPrice,
    volumeSettled: maxVolume,
    imbalance: imbalanceAtClearingPrice,
  };
};
