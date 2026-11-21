import { describe, expect, it } from 'vitest';
import { listPayLinksForWallet } from '../lib/paylink/pay-api';

describe('listPayLinksForWallet', () => {
  it('asks the solver for every wallet address once and maps the links without an owner secret', async () => {
    const urls: string[] = [];
    const links = await listPayLinksForWallet(
      'https://s.example/',
      [
        '0x76A914' + 'AB'.repeat(20) + '88AC',
        '76a914' + 'ab'.repeat(20) + '88ac',
      ],
      (async (url: string) => {
        urls.push(url);
        return new Response(
          JSON.stringify({
            links: [
              {
                id: 'abc',
                status: 'paid',
                token: 'PUSD',
                recipientAddress: 'bitcoincash:zexample',
                amountOut: '1300',
                createdAt: 1_795_000_000,
              },
            ],
          }),
        );
      }) as unknown as typeof fetch,
    );
    expect(urls).toEqual([
      'https://s.example/v1/links/by-recipient?bch=0x76a914' +
        'ab'.repeat(20) +
        '88ac',
    ]);
    expect(links[0]).toMatchObject({
      id: 'abc',
      amountOut: 13,
      status: 'paid',
    });
    expect(links[0]!.ownerSecret).toBeUndefined();
  });
});
