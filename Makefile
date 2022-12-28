.PHONY: all $(MAKECMDGOALS)

images:
	docker build --rm -t ff/account-graphql --build-arg=flavor=graphql -f ./code/backend/apps/account/docker/Dockerfile $(ARGS) ./code/backend
