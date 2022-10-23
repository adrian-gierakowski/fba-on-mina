# fba-on-mina

Prototype of a DEX using Frequent Batch Auction mechanism for settling trades. Implemented on [MINA](https://minaprotocol.com/).

# Design

In FBAs trades are processed in batches, with settlement occurring at the end of each discrete time period (form more details see [here](https://academic.oup.com/qje/article/130/4/1547/1916146#173478425)), therefore our design will be divided into phases.

## Phase 0

Participants deposit funds into a contract and lock them for certain amount of time (must be greater than T1 + T2 + T3, see below).

## Phase 1

Lasts for time period T1.
Order commitments are submitted. The commitment reveals the amount but not the price of the order. The amount of all orders submitted by any participant needs to be <= amount of funds locked in Phase 0.

## Phase 2

Starts immediately after T1 passes.
Last for time period T2.

In this phase submitters are supposed to reveal their orders. Failing to do so leads to loss of certain % of the amount of the order (see phase 3).
Revealing the order also authorizes it's settlement (funds required to settle have been locked in step 1).
(NOTE: orders can be revealed before T2 starts).

## Phase 3

Starts at the end of T2.
Last for time period T3 or until someone submits a settlement transaction.

Anyone can submit a settlement transaction and gets rewarded for doing so with % of the trading fees. This transaction leads to any eligible orders being settled.

Any order which have not been revealed by the time the settlement transaction is submitted, are canceled and a penalty is applied the submitters account.

Any orders which have not been settled are canceled. Alternatively, it should be possible for the submitter to specify how many rounds they want the order to remain active for, as long as the funds locked have been locked for a sufficient amount of time in Phase 0.

At this point the process repeats.

