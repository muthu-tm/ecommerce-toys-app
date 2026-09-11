import type { AddressDoc, AddressView } from '@romp/contracts';
import type { WithId } from '@romp/data';

/** Projects a stored address to the wire view — the document plus its ID. */
export function toAddressView(address: WithId<AddressDoc>): AddressView {
  return {
    id: address.id as AddressView['id'],
    label: address.label,
    recipientName: address.recipientName,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    phone: address.phone,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}
