import { getAddress } from '@ethersproject/address';
import { subgraphRequest } from '../../utils';
import { strategy as erc721Strategy } from '../erc721';

export const author = 'greenealexander';
export const version = '1.2.0';

// subgraph query in filter has max length of 500
const EVENT_IDS_LIMIT = 500;
const POAP_API_ENDPOINT_URL = {
  '1': 'https://subgrapher.snapshot.org/subgraph/arbitrum/J4XbkvmPeCwBstAGXFwvWih4TFfmcp5xbmpXLaNeSBtp',
  '100':
    'https://subgrapher.snapshot.org/subgraph/arbitrum/41xbTurY2KEHZdwFYPXAZTgRL8n4Cf3RfV3X4GSuUckp'
};
// subgraph query in filter has max length of 500
const MAX_ACCOUNTS_IN_QUERY = 500;

export async function strategy(
  space,
  network,
  provider,
  addresses,
  options,
  snapshot
) {
  const shouldFilterForEvents = (options?.eventIds?.length ?? 0) > 0;

  if (!shouldFilterForEvents) {
    const results = await erc721Strategy(
      space,
      network,
      provider,
      addresses,
      { address: '0x22C1f6050E56d2876009903609a2cC3fEf83B415' },
      snapshot
    );
    return addresses.reduce((map, address) => {
      map[getAddress(address)] = results[address] ?? 0;
      return map;
    }, {});
  }

  if (shouldFilterForEvents && options.eventIds.length > EVENT_IDS_LIMIT) {
    throw new Error(`Max number (${EVENT_IDS_LIMIT}) of event ids exceeded`);
  }

  const addressesMap = addresses.reduce((map, address) => {
    map[getAddress(address)] = 0;
    return map;
  }, {});
  const lowercaseAddresses = Object.keys(addressesMap).map((address) =>
    address.toLowerCase()
  );

  // batch addresses to query into slices of MAX_ACCOUNTS_IN_QUERY size
  const lowercaseAddressBatches: string[][] = [];
  for (let i = 0; i < lowercaseAddresses.length; i += MAX_ACCOUNTS_IN_QUERY) {
    const slice = lowercaseAddresses.slice(i, i + MAX_ACCOUNTS_IN_QUERY);
    lowercaseAddressBatches.push(slice);
  }

  const results = await Promise.allSettled<{
    accounts: { id: string; tokens?: { id: string }[] }[];
  }>(
    lowercaseAddressBatches.map((addresses) => {
      const batchQuery = {
        accounts: {
          __args: {
            first: addresses.length,
            where: {
              id_in: addresses
            }
          },
          id: true,
          tokens: {
            __args: {
              where: {
                event_in: options.eventIds
              }
            },
            id: true
          }
        }
      };
      if (snapshot !== 'latest') {
        batchQuery.accounts.__args['block'] = { number: snapshot };
      }
      return subgraphRequest(POAP_API_ENDPOINT_URL[network], batchQuery);
    })
  );

  if (results.some((result) => result.status === 'rejected')) {
    throw new Error(`Error fetching data in poap strategy`);
  }

  for (const supplyResponse of results) {
    if (supplyResponse.status === 'rejected') continue;

    for (const account of supplyResponse.value.accounts) {
      const accountId = getAddress(account.id);

      if (addressesMap[accountId] === undefined) continue;

      addressesMap[accountId] = account.tokens?.length ?? 0;
    }
  }

  return addressesMap;
}
