export interface SampleItemCreatedEvent {
  type: 'sample.item.created';
  companyId: string;
  itemId: string;
  name: string;
  occurredAt: string;
}
