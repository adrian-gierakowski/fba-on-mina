export type Order = Readonly<{
  price: number;
  size: number;
}>;

export const calculateClearingPrice = (
  buyOrders: ReadonlyArray<Order>,
  sellOrders: ReadonlyArray<Order>,
  minTickSize: number
) => {
  const numBuys = buyOrders.length;
  const numSells = sellOrders.length;

  let prices = [];

  for (let step = 0; step < numBuys; step++) {
    if (prices.indexOf(buyOrders[step].price) === -1) {
      prices.push(buyOrders[step].price);
    }
  }

  for (let step = 0; step < numSells; step++) {
    if (prices.indexOf(sellOrders[step].price) === -1) {
      prices.push(sellOrders[step].price);
    }
  }

  // console.log('check1:', _prices);
  prices = prices.sort(function (a, b) {
    return a - b;
  });
  // console.log('check2:', _prices);

  const numPricePoints = prices.length;
  const buyVolumes: number[] = [];
  const sellVolumes: number[] = [];
  const imbalances: number[] = [];

  for (let step = 0; step < numBuys; step++) {
    buyVolumes[buyOrders[step].price] =
      (buyVolumes[buyOrders[step].price] || 0) + buyOrders[step].size;
  }
  for (let step = 0; step < numSells; step++) {
    sellVolumes[sellOrders[step].price] =
      (sellVolumes[sellOrders[step].price] || 0) + sellOrders[step].size;
  }
  // console.log('check3.1:', _buyVolumes);
  // console.log('check3.2:', _sellVolumes);
  for (let step = 0; step < numPricePoints - 1; step++) {
    buyVolumes[prices[numPricePoints - 2 - step]] =
      (buyVolumes[prices[numPricePoints - 2 - step]] || 0) +
      (buyVolumes[prices[numPricePoints - 1 - step]] || 0);
    sellVolumes[prices[1 + step]] =
      (sellVolumes[prices[1 + step]] || 0) + (sellVolumes[prices[step]] || 0);
  }

  const _clearingVolumes = [];
  for (let step = 0; step < numPricePoints; step++) {
    _clearingVolumes[prices[step]] = Math.min(
      buyVolumes[prices[step]] || 0,
      (sellVolumes[prices[step]] || 0) * prices[step]
    );
  }
  // console.log('check4:', _clearingVolumes);
  let maxVolume = 0;
  let clearingPrice = -1;
  for (let step = 0; step < numPricePoints; step++) {
    if (_clearingVolumes[prices[step]] > maxVolume) {
      maxVolume = _clearingVolumes[prices[step]];
      clearingPrice = prices[step];
    }
  }
  // console.log('check4.1:', _maxVolume);
  for (let step = 0; step < numPricePoints; step++) {
    imbalances[prices[step]] =
      buyVolumes[prices[step]] - sellVolumes[prices[step]] * prices[step];
  }

  // console.log('check4.2:', _clearingVolumes.indexOf(_maxVolume));
  let imbalanceAtClearingPrice = imbalances[clearingPrice];
  // console.log('check5:', _clearingPrice, _imbalance);
  let buyVolumeFinal = 0;
  let sellVolumeFinal = 0;

  if (imbalanceAtClearingPrice > 0) {
    for (let step = 0; step < numBuys; step++) {
      if (buyOrders[step].price > clearingPrice) {
        buyVolumeFinal += buyOrders[step].size;
      }
    }

    for (let step = 0; step < numSells; step++) {
      if (sellOrders[step].price <= clearingPrice) {
        sellVolumeFinal += sellOrders[step].size;
      }
    }

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
    for (let step = 0; step < numBuys; step++) {
      if (buyOrders[step].price >= clearingPrice) {
        buyVolumeFinal += buyOrders[step].size;
      }
    }

    for (let step = 0; step < numSells; step++) {
      if (sellOrders[step].price < clearingPrice) {
        sellVolumeFinal += sellOrders[step].size;
      }
    }

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
