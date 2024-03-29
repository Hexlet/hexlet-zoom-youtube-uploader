PHONY=migration-generate
V?=patch
NAME?=migration
USER_UID=$(shell id -u)
USER_GID=$(shell id -g)

setup: install-dependencies create-config run
install-dependencies:
	npm ci
create-config:
	cp -n development.env.example development.env || true

# local run
dev:
	NODE_ENV=development npx nodemon ./bin/index.js
run:
	chmod +x ./bin/index.js && NODE_ENV=production ./bin/index.js &
stop: stop-node
stop-node:
	kill -15 `pidof node` || true

# make migration-generate NAME="hello"
migration-generate: MIGRATION_FILEPATH=migrations/$$(date -u +%Y%m%d%H%M%S)-$(NAME).sql
migration-generate:
	@> $(MIGRATION_FILEPATH)
	@echo "Generated file: $(MIGRATION_FILEPATH)"

time:
	date +"Now time is +%FT%T%z"

# dev
lint:
	npx eslint . --fix
test:
	NODE_ENV=test npm test -s
test-dev:
	NODE_ENV=test npm test -s -- --watchAll
test-cov:
	NODE_ENV=test npm run test-cov
version:
	npm version ${V} && git push --tags
dep-update:
	npx npm-check-updates -u

# usage with docker
container-setup: container-build container-dependency container-run
container-build:
	docker-compose build
container-dependency:
	docker-compose run --rm -u $(USER_UID):$(USER_GID) backend make install-dependencies
container-run: create-config
	docker-compose run --rm -u $(USER_UID):$(USER_GID) -p 5000:5000 backend /bin/bash
container-test:
	docker-compose run --rm -u $(USER_UID):$(USER_GID) backend make test
