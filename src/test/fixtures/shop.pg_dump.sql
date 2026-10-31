--
-- PostgreSQL database dump
--

\restrict po0zYYufPytb1Hg0ThKh4YTXpO1GVpOwHaRFsFI0iVj31l5z4Wn7rTI135wJzqk

-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: delivery_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_type (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    price numeric(10,2) NOT NULL
);


--
-- Name: COLUMN delivery_type.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.delivery_type.id IS 'Primary key';


--
-- Name: COLUMN delivery_type.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.delivery_type.name IS 'Delivery type name';


--
-- Name: COLUMN delivery_type.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.delivery_type.description IS 'Delivery type description';


--
-- Name: COLUMN delivery_type.price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.delivery_type.price IS 'Delivery price';


--
-- Name: discount; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    percentage numeric(5,2) NOT NULL,
    valid_from date NOT NULL,
    valid_to date NOT NULL
);


--
-- Name: COLUMN discount.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discount.id IS 'Primary key';


--
-- Name: COLUMN discount.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discount.code IS 'Discount code';


--
-- Name: COLUMN discount.percentage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discount.percentage IS 'Discount percentage';


--
-- Name: COLUMN discount.valid_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discount.valid_from IS 'Start date of validity';


--
-- Name: COLUMN discount.valid_to; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.discount.valid_to IS 'End date of validity';


--
-- Name: order; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."order" (
    id integer NOT NULL,
    user_id integer NOT NULL,
    delivery_type_id integer NOT NULL,
    discount_id integer,
    status text NOT NULL,
    total_price numeric(10,2) NOT NULL,
    created_at timestamp without time zone NOT NULL,
    CONSTRAINT order_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'CONFIRMED'::text, 'SHIPPED'::text, 'DELIVERED'::text, 'CANCELLED'::text])))
);


--
-- Name: COLUMN "order".id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".id IS 'Primary key';


--
-- Name: COLUMN "order".user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".user_id IS 'Reference to the user who placed the order';


--
-- Name: COLUMN "order".delivery_type_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".delivery_type_id IS 'Reference to the selected delivery type';


--
-- Name: COLUMN "order".discount_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".discount_id IS 'Reference to applied discount (optional)';


--
-- Name: COLUMN "order".status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".status IS 'Order status';


--
-- Name: COLUMN "order".total_price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".total_price IS 'Total order price';


--
-- Name: COLUMN "order".created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."order".created_at IS 'Order creation timestamp';


--
-- Name: product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    price numeric(10,2) NOT NULL,
    stock_quantity integer NOT NULL
);


--
-- Name: COLUMN product.id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product.id IS 'Primary key';


--
-- Name: COLUMN product.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product.name IS 'Product name';


--
-- Name: COLUMN product.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product.description IS 'Product description';


--
-- Name: COLUMN product.price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product.price IS 'Product price';


--
-- Name: COLUMN product.stock_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.product.stock_quantity IS 'Available stock quantity';


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    id integer NOT NULL,
    user_name character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    created_at timestamp without time zone NOT NULL
);


--
-- Name: COLUMN "user".id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."user".id IS 'Primary key';


--
-- Name: COLUMN "user".user_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."user".user_name IS 'Login name';


--
-- Name: COLUMN "user".email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."user".email IS 'Email address';


--
-- Name: COLUMN "user".password_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."user".password_hash IS 'Hashed password';


--
-- Name: COLUMN "user".created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public."user".created_at IS 'Account creation timestamp';


--
-- Name: delivery_type delivery_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_type
    ADD CONSTRAINT delivery_type_pkey PRIMARY KEY (id);


--
-- Name: discount discount_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount
    ADD CONSTRAINT discount_pkey PRIMARY KEY (id);


--
-- Name: order order_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_pkey PRIMARY KEY (id);


--
-- Name: product product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product
    ADD CONSTRAINT product_pkey PRIMARY KEY (id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: order order_delivery_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_delivery_type_id_fkey FOREIGN KEY (delivery_type_id) REFERENCES public.delivery_type(id);


--
-- Name: order order_discount_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES public.discount(id);


--
-- Name: order order_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."order"
    ADD CONSTRAINT order_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- PostgreSQL database dump complete
--

\unrestrict po0zYYufPytb1Hg0ThKh4YTXpO1GVpOwHaRFsFI0iVj31l5z4Wn7rTI135wJzqk

