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
router.post('/price-tables/preview', authenticate, requireAdmin, upload.single('file'), priceTables.previewExcelImport)
router.post('/price-tables/import', authenticate, requireAdmin, upload.single('file'), priceTables.confirmExcelImport)
router.post('/price-tables/import-catalog', authenticate, requireAdmin, upload.single('file'), priceTables.importCatalog)
router.post('/price-tables/import-photos-zip', authenticate, requireAdmin, uploadZip.single('file'), priceTables.importPhotosZip)
router.post('/price-tables/:id/photo-by-ref', authenticate, requireAdmin, upload.single('file'), priceTables.uploadPhotoByRef)
router.delete('/price-tables/:id/images', authenticate, requireAdmin, priceTables.clearProductImages)
router.delete('/price-tables/:id', authenticate, requireAdmin, priceTables.deletePriceTable)

// Produtos
router.get('/products', authenticate, priceTables.listProducts)
router.post('/products/:id/image', authenticate, requireAdmin, upload.single('image'), priceTables.uploadProductImage)
router.put('/products/:product_id/grade', authenticate, requireAdmin, priceTables.updateGradeConfig)
router.patch('/products/:id/availability', authenticate, requireAdmin, priceTables.updateProductAvailability)
router.patch('/products/:id/blocked-sizes', authenticate, requireAdmin, priceTables.updateBlockedSizes)

// Clientes
router.get('/clients', authenticate, clients.listClients)
router.get('/clients/:id', authenticate, clients.getClient)
router.post('/clients', authenticate, clients.createClient)
router.put('/clients/:id', authenticate, clients.updateClient)
router.post('/clients/import/preview', authenticate, upload.single('file'), clientsImport.previewImport)
router.post('/clients/import/confirm', authenticate, upload.single('file'), clientsImport.confirmImport)

// Pedidos
router.get('/orders', authenticate, orders.listOrders)
router.get('/orders/trash', authenticate, requireAdmin, orders.listTrashedOrders)
router.get('/orders/:id', authenticate, orders.getOrder)
router.post('/orders', authenticate, orders.createOrder)
router.patch('/orders/:id/status', authenticate, orders.updateOrderStatus)
router.patch('/orders/:id/info', authenticate, orders.updateOrderInfo)
router.put('/orders/:id/price-table', authenticate, orders.changeOrderPriceTable)
router.patch('/orders/:id/restore', authenticate, requireAdmin, orders.restoreOrder)
router.delete('/orders/:id', authenticate, orders.deleteOrder)
router.post('/orders/:id/items', authenticate, orders.addOrderItems)
router.patch('/orders/:id/items/:item_id', authenticate, orders.updateOrderItem)
router.delete('/orders/:id/items/:item_id', authenticate, orders.removeOrderItem)
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
router.post('/company/logo', authenticate, requireAdmin, upload.single('logo'), company.uploadLogo)
router.delete('/company/logo', authenticate, requireAdmin, company.deleteLogo)

// Status
router.get('/statuses', authenticate, statuses.listStatuses)
router.post('/statuses', authenticate, requireAdmin, statuses.createStatus)
router.put('/statuses/:id', authenticate, requireAdmin, statuses.updateStatus)
router.delete('/statuses/:id', authenticate, requireAdmin, statuses.deleteStatus)
router.post('/statuses/reorder', authenticate, requireAdmin, statuses.reorderStatuses)

export default router
