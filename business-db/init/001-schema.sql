CREATE DATABASE IF NOT EXISTS orders_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE orders_app;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NOT NULL,
  status ENUM('pending', 'processing', 'completed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_orders_status_created_at (status, created_at)
);

INSERT INTO orders (customer_name, description, status)
SELECT 'Cliente demonstracao', 'Pedido inicial do laboratorio', 'pending'
WHERE NOT EXISTS (SELECT 1 FROM orders);
