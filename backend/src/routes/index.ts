import { Router } from 'express'
import multer from 'multer'
import os from 'os'
import { authenticate, requireAdmin } from '../middleware/auth'
import * as auth from '../controllers/authController'
import * as users from '../controllers/usersController'
import * as factories from '../controllers/factoriesController'
import * as priceTables from '../controllers/priceTablesController'
import * as clients from '../controllers/clientsController'
import * as orders from '../controllers/ordersController'
import * as statuses from '../controllers/statusController'
import * as clientsImport from '../controllers/clientsImportController'
import * as company from '../controllers/companyController'
import * as reports from '../controllers/reportsController'
import * as prospecting from '../controllers/prospectingController'
import * as portal from '../controllers/portalController'
import * as goals from '../controllers/goalsController'
import * as pdf from '../controllers/pdfController'
import * as pe from '../controllers/peController'
import * as paymentConds from '../controllers/paymentConditionsController'
import * as integration from '../controllers/integrationController'

const router = Router()

// Multer — usa memória para poder enviar para R2
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB || '300')) * 1024 * 1024 },
})

// Multer para ZIP de fotos — usa disco para suportar arquivos grandes (1GB+)
const uploadZip = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `zip-${Date.now()}.zip`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
})

// Auth
router.post('/auth/login', auth.login)
router.post('/auth/refresh', auth.refresh)
router.post('/auth/logout', auth.logout)
router.get('/auth/me', authenticate, auth.me)

// Usuários (admin only)
router.get('/users', authenticate, requireAdmin, users.listUsers)
router.post('/users', authenticate, requireAdmin, users.createUser)
router.put('/users/:id', authenticate, requireAdmin, users.updateUser)
router.delete('/users/:id', authenticate, requireAdmin, users.deleteUser)

// Fábricas
router.get('/factories', authenticate, factories.listFactories)
router.get('/factories/:id', authenticate, factories.getFactory)
router.post('/factories', authenticate, requireAdmin, factories.createFactory)
router.put('/factories/:id', authenticate, requireAdmin, factories.updateFactory)
router.post('/factories/:id/logo', authenticate, requireAdmin, upload.single('logo'), factories.uploadLogo)

// Tabelas de Preço
router.get('/price-tables', authenticate, priceTables.listPriceTables)
router.get('/price-tables/:id', authenticate, priceTables.getPriceTable)
router.post('/price-tables', authenticate, requireAdmin, priceTables.createPriceTable)
router.post('/price-tables/preview', authenticate, requireAdmin, upload.single('file'), priceTables.previewExcelImport)
router.post('/price-tables/import', authenticate, requireAdmin, upload.single('file'), priceTables.confirmExcelImport)
router.post('/price-tables/import-catalog', authenticate, requireAdmin, upload.single('file'), priceTables.importCatalog)
router.post('/price-tables/import-photos-zip', authenticate, requireAdmin, uploadZip.single('file'), priceTables.importPhotosZip)
router.post('/price-tables/import-stock', authenticate, requireAdmin, upload.single('file'), priceTables.importStock)
router.post('/price-tables/:id/update-import', authenticate, requireAdmin, upload.single('file'), priceTables.updateTableFromExcel)
router.post('/price-tables/:id/update-grades', authenticate, requireAdmin, upload.single('file'), priceTables.updateGradesFromSheet)
router.post('/price-tables/:id/photo-by-ref', authenticate, requireAdmin, upload.single('file'), priceTables.uploadPhotoByRef)
router.post('/price-tables/:id/gallery-by-ref', authenticate, requireAdmin, upload.single('file'), priceTables.addGalleryImageByRef)
router.delete('/price-tables/:id/images', authenticate, requireAdmin, priceTables.clearProductImages)
router.put('/price-tables/:id', authenticate, requireAdmin, priceTables.updatePriceTableRules)
router.delete('/price-tables/:id', authenticate, requireAdmin, priceTables.deletePriceTable)

// Produtos
router.get('/products', authenticate, priceTables.listProducts)
router.get('/products/sem-fotos', authenticate, priceTables.downloadSemFotos)
router.post('/products', authenticate, requireAdmin, priceTables.createProduct)
router.post('/products/:id/duplicate', authenticate, requireAdmin, priceTables.duplicateProduct)
router.post('/products/:id/image', authenticate, requireAdmin, upload.single('file'), priceTables.uploadProductImage)
// Galeria (várias fotos por produto)
router.get('/products/:id/images', authenticate, priceTables.listProductImages)
router.post('/products/:id/images', authenticate, requireAdmin, upload.single('file'), priceTables.addProductImage)
router.delete('/products/:id/images/:imageId', authenticate, requireAdmin, priceTables.deleteProductImage)
router.patch('/products/:id/images/:imageId/cover', authenticate, requireAdmin, priceTables.setCoverImage)
router.put('/products/:product_id/grade', authenticate, requireAdmin, priceTables.updateGradeConfig)
router.patch('/products/:id', authenticate, requireAdmin, priceTables.updateProduct)
router.delete('/products/:id', authenticate, requireAdmin, priceTables.deleteProduct)
router.patch('/products/:id/availability', authenticate, requireAdmin, priceTables.updateProductAvailability)
router.patch('/products/:id/blocked-sizes', authenticate, requireAdmin, priceTables.updateBlockedSizes)

// Clientes
router.get('/clients', authenticate, clients.listClients)
router.get('/clients/export/xlsx', authenticate, clients.exportClients)
router.get('/clients/map', authenticate, clients.clientsMap)
router.get('/clients/:id', authenticate, clients.getClient)
router.post('/clients', authenticate, clients.createClient)
router.put('/clients/:id', authenticate, clients.updateClient)
router.delete('/clients/:id', authenticate, clients.deleteClient)
router.post('/clients/import/preview', authenticate, upload.single('file'), clientsImport.previewImport)
router.post('/clients/import/confirm', authenticate, upload.single('file'), clientsImport.confirmImport)

// Pedidos
router.get('/orders/:id/pdf', authenticate, pdf.getOrderPdf)
router.get('/orders/summary', authenticate, orders.ordersSummary)
router.get('/orders/meta-fabricas', authenticate, orders.metaFabricas)
router.get('/orders/alerts', authenticate, orders.listOrderAlerts)
router.post('/orders/:id/alerts/dismiss', authenticate, orders.dismissOrderAlert)
router.get('/orders', authenticate, orders.listOrders)
router.get('/orders/trash', authenticate, requireAdmin, orders.listTrashedOrders)
router.get('/orders/:id', authenticate, orders.getOrder)
router.post('/orders', authenticate, orders.createOrder)
router.patch('/orders/:id/status', authenticate, orders.updateOrderStatus)
router.patch('/orders/:id/info', authenticate, orders.updateOrderInfo)
router.patch('/orders/:id/commission', authenticate, requireAdmin, orders.updateOrderCommission)
router.delete('/orders/:id/commission', authenticate, requireAdmin, orders.resetOrderCommission)
router.put('/orders/:id/price-table', authenticate, orders.changeOrderPriceTable)
router.patch('/orders/:id/restore', authenticate, requireAdmin, orders.restoreOrder)
router.post('/orders/:id/duplicate', authenticate, orders.duplicateOrder)
router.delete('/orders/:id', authenticate, orders.deleteOrder)
router.post('/orders/:id/items', authenticate, orders.addOrderItems)
router.patch('/orders/:id/items/:item_id', authenticate, orders.updateOrderItem)
router.delete('/orders/:id/items/:item_id', authenticate, orders.removeOrderItem)
router.post('/orders/:id/recalculate', authenticate, orders.recalcOrderTotals)
router.post('/orders/sync', authenticate, orders.syncOfflineOrders)

// Relatórios
router.get('/reports/orders', authenticate, reports.ordersReport)
router.get('/reports/commissions', authenticate, reports.commissionsReport)
router.get('/reports/clients', authenticate, reports.clientsReport)
router.get('/reports/products', authenticate, reports.productsReport)
router.get('/reports/collections', authenticate, reports.collectionsReport)
router.get('/reports/catalog', authenticate, reports.catalogReport)

// Empresa (Somma)
router.get('/company', authenticate, company.getSettings)
router.put('/company', authenticate, requireAdmin, company.updateSettings)

// ── Integração com o SOMMA Maps ──
router.get   ('/integration/info',  authenticate, requireAdmin, integration.getInfo)
router.post  ('/integration/token', authenticate, requireAdmin, integration.gerarToken)
router.delete('/integration/token', authenticate, requireAdmin, integration.revogarToken)
router.get   ('/integration/sales', integration.getSales)  // autenticado por X-Integration-Token
router.post('/company/logo', authenticate, requireAdmin, upload.single('logo'), company.uploadLogo)
router.delete('/company/logo', authenticate, requireAdmin, company.deleteLogo)

// Prospecção
router.get('/prospecting/nearby', authenticate, prospecting.searchNearby)
router.get('/prospecting/place/:place_id', authenticate, prospecting.getPlaceDetails)
router.get('/prospecting/find-cnpj', authenticate, prospecting.findCnpj)
router.get('/prospecting/cnpj/:cnpj', authenticate, prospecting.lookupCnpj)
router.get('/prospecting/contacts', authenticate, prospecting.listContacts)
router.post('/prospecting/contacts', authenticate, prospecting.createContact)
router.patch('/prospecting/contacts/:id', authenticate, prospecting.updateContact)
router.delete('/prospecting/contacts/:id', authenticate, prospecting.deleteContact)

// Status
router.get('/statuses', authenticate, statuses.listStatuses)
router.post('/statuses', authenticate, requireAdmin, statuses.createStatus)
router.put('/statuses/:id', authenticate, requireAdmin, statuses.updateStatus)
router.delete('/statuses/:id', authenticate, requireAdmin, statuses.deleteStatus)
router.post('/statuses/reorder', authenticate, requireAdmin, statuses.reorderStatuses)

// Condições de pagamento pré-cadastradas
router.get   ('/payment-conditions',         authenticate,              paymentConds.listConditions)
router.post  ('/payment-conditions',         authenticate, requireAdmin, paymentConds.createCondition)
router.put   ('/payment-conditions/:id',     authenticate, requireAdmin, paymentConds.updateCondition)
router.delete('/payment-conditions/:id',     authenticate, requireAdmin, paymentConds.deleteCondition)
router.post  ('/payment-conditions/reorder', authenticate, requireAdmin, paymentConds.reorderConditions)

// ── Portal de Pedidos (autenticado — gerenciamento pelo rep)
router.get('/portals', authenticate, portal.listPortals)
router.post('/portals', authenticate, portal.createPortal)
router.put('/portals/:id', authenticate, portal.updatePortal)
router.delete('/portals/:id', authenticate, portal.deletePortal)

// ── Portal de Pedidos (PÚBLICO — cliente sem login)
router.get('/public/portal/:token', portal.getPortalInfo)
router.post('/public/portal/:token/lookup-cnpj', portal.portalLookupCnpj)
router.get('/public/portal/:token/catalog', portal.getPortalCatalog)
router.post('/public/portal/:token/order', portal.submitPortalOrder)

// ── Metas ──────────────────────────────────────────────────────────────────────
router.get('/goals', authenticate, goals.listGoals)                        // reps veem metas relevantes
router.post('/goals', authenticate, requireAdmin, goals.createGoal)
router.put('/goals/:id', authenticate, requireAdmin, goals.updateGoal)
router.delete('/goals/:id', authenticate, requireAdmin, goals.deleteGoal)

export default router

// Novos relatórios
router.get('/reports/sales-evolution', authenticate, reports.salesEvolutionReport)
router.get('/reports/inactive-clients', authenticate, reports.inactiveClientsReport)
router.get('/reports/rep-performance', authenticate, requireAdmin, reports.repPerformanceReport)
router.get('/reports/abc-clients', authenticate, reports.abcClientsReport)
router.get('/reports/period-comparison', authenticate, reports.periodComparisonReport)
router.get('/reports/region', authenticate, reports.regionReport)
router.get('/reports/commission-projection', authenticate, reports.commissionProjectionReport)

// ── Pronta Entrega ────────────────────────────────────────────────────────────
router.get('/pe', authenticate, pe.listPeCatalogs)
router.post('/pe', authenticate, pe.createPeCatalog)
router.post('/pe/:id/import', authenticate, upload.single('file'), pe.importPeExcel)
router.patch('/pe/:id/toggle', authenticate, pe.togglePeCatalog)
router.delete('/pe/:id', authenticate, pe.deletePeCatalog)
