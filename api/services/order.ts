export * from "./order-shared";
import * as order_read from "./order-read";
import * as order_create from "./order-create";
import * as order_status from "./order-status";
import * as order_items from "./order-items";
import * as order_settlement from "./order-settlement";

/*
  Фасад: OrderService собирается из модулей, чтобы все прежние вызовы
  (`OrderService.create(...)`) и импорты остались как были. Тело — в
  order-read / order-create / order-status / order-items / order-settlement.
*/
export const OrderService = {
  list: order_read.list,
  getById: order_read.getById,
  myOrders: order_read.myOrders,
  batchGetOrdersForPrint: order_read.batchGetOrdersForPrint,
  markInvoicesPrinted: order_read.markInvoicesPrinted,
  getManyForCompletion: order_read.getManyForCompletion,
  getAdjustments: order_read.getAdjustments,
  getOrderPayments: order_read.getOrderPayments,
  create: order_create.create,
  cancel: order_status.cancel,
  updateStatus: order_status.updateStatus,
  bulkUpdateStatus: order_status.bulkUpdateStatus,
  delete: order_status.deleteOrder,
  restore: order_status.restore,
  bulkAssignAgent: order_status.bulkAssignAgent,
  update: order_items.update,
  updateItems: order_items.updateItems,
  recordPartialPayment: order_settlement.recordPartialPayment,
  recordPartialDelivery: order_settlement.recordPartialDelivery,
  bulkCompleteWithPayment: order_settlement.bulkCompleteWithPayment,
  bulkCompleteDetailed: order_settlement.bulkCompleteDetailed,
  recordDeliveryAndPayment: order_settlement.recordDeliveryAndPayment,
};
