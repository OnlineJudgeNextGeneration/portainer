angular.module('templates', [])
.controller('TemplatesController', ['$scope', '$q', '$state', '$stateParams', '$anchorScroll', '$filter', 'ContainerService', 'ContainerHelper', 'ImageService', 'NetworkService', 'TemplateService', 'TemplateHelper', 'VolumeService', 'Notifications', 'Pagination', 'ResourceControlService', 'Authentication', 'ControllerDataPipeline', 'FormValidator',
function ($scope, $q, $state, $stateParams, $anchorScroll, $filter, ContainerService, ContainerHelper, ImageService, NetworkService, TemplateService, TemplateHelper, VolumeService, Notifications, Pagination, ResourceControlService, Authentication, ControllerDataPipeline, FormValidator) {
  $scope.state = {
    selectedTemplate: null,
    showAdvancedOptions: false,
    hideDescriptions: $stateParams.hide_descriptions,
    formValidationError: '',
    filters: {
      Categories: '!',
      Platform: '!'
    }
  };

  $scope.formValues = {
    network: '',
    name: ''
  };

  $scope.addVolume = function () {
    $scope.state.selectedTemplate.Volumes.push({ containerPath: '', name: '', readOnly: false, type: 'auto' });
  };

  $scope.removeVolume = function(index) {
    $scope.state.selectedTemplate.Volumes.splice(index, 1);
  };

  $scope.addPortBinding = function() {
    $scope.state.selectedTemplate.Ports.push({ hostPort: '', containerPort: '', protocol: 'tcp' });
  };

  $scope.removePortBinding = function(index) {
    $scope.state.selectedTemplate.Ports.splice(index, 1);
  };

  function validateForm(accessControlData, isAdmin) {
    $scope.state.formValidationError = '';
    var error = '';
    error = FormValidator.validateAccessControl(accessControlData, isAdmin);

    if (error) {
      $scope.state.formValidationError = error;
      return false;
    }
    return true;
  }

  $scope.createTemplate = function() {
    $('#createContainerSpinner').show();

    var userDetails = Authentication.getUserDetails();
    var accessControlData = ControllerDataPipeline.getAccessControlFormData();
    var isAdmin = userDetails.role === 1 ? true : false;

    if (!validateForm(accessControlData, isAdmin)) {
      $('#createContainerSpinner').hide();
      return;
    }

    var template = $scope.state.selectedTemplate;
    var templateConfiguration = createTemplateConfiguration(template);
    var generatedVolumeCount = TemplateHelper.determineRequiredGeneratedVolumeCount(template.Volumes);
    var generatedVolumeIds = [];
    VolumeService.createXAutoGeneratedLocalVolumes(generatedVolumeCount)
    .then(function success(data) {
      var volumeResourceControlQueries = [];
      angular.forEach(data, function (volume) {
        var volumeId = volume.Id;
        generatedVolumeIds.push(volumeId);
      });
      TemplateService.updateContainerConfigurationWithVolumes(templateConfiguration, template, data);
      return ImageService.pullImage(template.Image, template.Registry);
    })
    .then(function success(data) {
      return ContainerService.createAndStartContainer(templateConfiguration);
    })
    .then(function success(data) {
      var containerIdentifier = data.Id;
      var userId = userDetails.ID;
      return ResourceControlService.applyResourceControl('container', containerIdentifier, userId, accessControlData, generatedVolumeIds);
    })
    .then(function success() {
      Notifications.success('Container successfully created');
      $state.go('containers', {}, {reload: true});
    })
    .catch(function error(err) {
      Notifications.error('Failure', err, err.msg);
    })
    .finally(function final() {
      $('#createContainerSpinner').hide();
    });
  };

  $scope.unselectTemplate = function() {
    var currentTemplateIndex = $scope.state.selectedTemplate.index;
    $('#template_' + currentTemplateIndex).toggleClass('template-container--selected');
    $scope.state.selectedTemplate = null;
  };

  $scope.selectTemplate = function(index, pos) {
    if ($scope.state.selectedTemplate && $scope.state.selectedTemplate.index !== index) {
      $scope.unselectTemplate();
    }

    var templates = $filter('filter')($scope.templates, $scope.state.filters, true);
    var template = templates[pos];
    if (template === $scope.state.selectedTemplate) {
      $scope.unselectTemplate();
    } else {
      selectTemplate(index, pos, templates);
    }
  };

  function selectTemplate(index, pos, filteredTemplates) {
    $('#template_' + index).toggleClass('template-container--selected');
    var selectedTemplate = filteredTemplates[pos];
    $scope.state.selectedTemplate = selectedTemplate;

    if (selectedTemplate.Network) {
      $scope.formValues.network = _.find($scope.availableNetworks, function(o) { return o.Name === selectedTemplate.Network; });
    } else {
      $scope.formValues.network = _.find($scope.availableNetworks, function(o) { return o.Name === 'bridge'; });
    }

    $anchorScroll('view-top');
  }

  function createTemplateConfiguration(template) {
    var network = $scope.formValues.network;
    var name = $scope.formValues.name;
    var containerMapping = determineContainerMapping(network);
    return TemplateService.createTemplateConfiguration(template, name, network, containerMapping);
  }

  function determineContainerMapping(network) {
    var endpointProvider = $scope.applicationState.endpoint.mode.provider;
    var containerMapping = 'BY_CONTAINER_IP';
    if (endpointProvider === 'DOCKER_SWARM' && network.Scope === 'global') {
      containerMapping = 'BY_SWARM_CONTAINER_NAME';
    } else if (network.Name !== 'bridge') {
      containerMapping = 'BY_CONTAINER_NAME';
    }
    return containerMapping;
  }

  function filterNetworksBasedOnProvider(networks) {
    var endpointProvider = $scope.applicationState.endpoint.mode.provider;
    if (endpointProvider === 'DOCKER_SWARM' || endpointProvider === 'DOCKER_SWARM_MODE') {
      if (endpointProvider === 'DOCKER_SWARM') {
        networks = NetworkService.filterGlobalNetworks(networks);
      } else {
        networks = NetworkService.filterSwarmModeAttachableNetworks(networks);
      }
      $scope.globalNetworkCount = networks.length;
      NetworkService.addPredefinedLocalNetworks(networks);
    }
    return networks;
  }

  function initTemplates() {
    var templatesKey = $stateParams.key;
    $q.all({
      templates: TemplateService.getTemplates(templatesKey),
      containers: ContainerService.containers(0),
      networks: NetworkService.networks(),
      volumes: VolumeService.getVolumes()
    })
    .then(function success(data) {
      $scope.templates = data.templates;
      var availableCategories = [];
      angular.forEach($scope.templates, function(template) {
        availableCategories = availableCategories.concat(template.Categories);
      });
      $scope.availableCategories = _.sortBy(_.uniq(availableCategories));
      $scope.runningContainers = data.containers;
      $scope.availableNetworks = filterNetworksBasedOnProvider(data.networks);
      $scope.availableVolumes = data.volumes.Volumes;
    })
    .catch(function error(err) {
      $scope.templates = [];
      Notifications.error('Failure', err, 'An error occured during apps initialization.');
    })
    .finally(function final(){
      $('#loadTemplatesSpinner').hide();
    });
  }

  initTemplates();
}]);
