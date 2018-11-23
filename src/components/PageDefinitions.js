// Copyright (c) Microsoft Corporation and others. Licensed under the MIT license.
// SPDX-License-Identifier: MIT

import React from 'react'
import { connect } from 'react-redux'
import { Grid, Button, DropdownButton, MenuItem, OverlayTrigger, Tooltip } from 'react-bootstrap'
import pako from 'pako'

import base64js from 'base64-js'
import { saveAs } from 'file-saver'
import notification from 'antd/lib/notification'

import trim from 'lodash/trim'
import get from 'lodash/get'
import { uiNavigation, uiBrowseUpdateList, uiRevertDefinition, uiInfo, uiWarning, uiDanger } from '../actions/ui'
import { getDefinitionsAction } from '../actions/definitionActions'
import { ROUTE_CURATIONS, ROUTE_DEFINITIONS, ROUTE_SHARE } from '../utils/routingConstants'
import EntitySpec from '../utils/entitySpec'
import AbstractPageDefinitions from './AbstractPageDefinitions'
import { getCurationAction } from '../actions/curationActions'
import NotificationButtons from './Navigation/Ui/NotificationButtons'
import { asObject } from '../utils/utils'
import { getGist, saveGist } from '../api/github'
import SearchBar from './Navigation/Ui/SearchBar'
import { ComponentList, Section, ContributePrompt } from './'
import FullDetailPage from './FullDetailView/FullDetailPage'

export class PageDefinitions extends AbstractPageDefinitions {
  constructor(props) {
    super(props)
    this.onDrop = this.onDrop.bind(this)
    this.onAddComponent = this.onAddComponent.bind(this)
    this.doSave = this.doSave.bind(this)
    this.doSaveAsUrl = this.doSaveAsUrl.bind(this)
    this.revertAll = this.revertAll.bind(this)
    this.revertDefinition = this.revertDefinition.bind(this)
  }

  componentDidMount() {
    const { dispatch, path } = this.props
    if (path.length > 1) {
      try {
        const definitionSpec = pako.inflate(base64js.toByteArray(path), { to: 'string' })
        this.loadFromListSpec(JSON.parse(definitionSpec))
      } catch (e) {
        uiWarning(dispatch, 'Loading components from URL failed')
      }
    }
    dispatch(uiNavigation({ to: ROUTE_DEFINITIONS }))
  }

  tableTitle() {
    return 'Available definitions'
  }

  doRefreshAll = () => {
    if (this.hasChanges()) {
      const key = `open${Date.now()}`
      notification.open({
        message: 'Unsaved Changes',
        description: 'Some information has been changed and is currently unsaved. Are you sure to continue?',
        btn: (
          <NotificationButtons
            onClick={() => {
              this.refresh()
              notification.close(key)
            }}
            onClose={() => notification.close(key)}
            confirmText="Refresh"
            dismissText="Dismiss"
          />
        ),
        key,
        onClose: notification.close(key),
        duration: 0
      })
    } else {
      this.refresh()
    }
  }

  tooltip(text) {
    return <Tooltip id="tooltip">{text}</Tooltip>
  }

  renderButtonWithTip(button, tip) {
    const toolTip = <Tooltip id="tooltip">{tip}</Tooltip>
    return (
      <OverlayTrigger placement="top" overlay={toolTip}>
        {button}
      </OverlayTrigger>
    )
  }

  renderButtons() {
    return (
      <div className="pull-right">
        {this.renderButtonWithTip(
          <Button bsStyle="danger" disabled={!this.hasChanges()} onClick={this.revertAll}>
            <i className="fas fa-undo" />
            <span>&nbsp;Revert Changes</span>
          </Button>,
          'Revert all changes of all the definitions'
        )}
        <Button bsStyle="default" disabled={!this.hasComponents()} onClick={this.doRefreshAll}>
          Refresh
        </Button>
        &nbsp;
        <Button bsStyle="default" disabled={!this.hasComponents()} onClick={this.collapseAll}>
          Collapse All
        </Button>
        &nbsp;
        <Button bsStyle="danger" disabled={!this.hasComponents()} onClick={this.onRemoveAll}>
          Clear All
        </Button>
        &nbsp;
        {this.renderShareButton()}
        &nbsp;
        <Button bsStyle="success" disabled={!this.hasChanges()} onClick={this.doPromptContribute}>
          Contribute
        </Button>
      </div>
    )
  }

  renderShareButton() {
    const { components } = this.props
    const disabled = components.list.length === 0
    return (
      <DropdownButton disabled={disabled} id={'sharedropdown'} title="Share" bsStyle="success">
        <MenuItem eventKey="1" onSelect={this.doSaveAsUrl}>
          URL
        </MenuItem>
        <MenuItem eventKey="2" onSelect={() => this.setState({ showSavePopup: true })}>
          File
        </MenuItem>
        <MenuItem eventKey="3" onSelect={() => this.setState({ showSavePopup: true, saveType: 'gist' })}>
          Gist
        </MenuItem>
        <MenuItem divider />
        <MenuItem disabled>Definitions (Not implemented)</MenuItem>
        <MenuItem disabled>SPDX (Not implemented)</MenuItem>
      </DropdownButton>
    )
  }

  updateList(o) {
    return uiBrowseUpdateList(o)
  }

  noRowsRenderer() {
    return (
      <div className="list-noRows">
        <div>
          <p>Search for components in the above search bar or drag and drop...</p>
          <ul>
            <li>the URL for a component version/commit from nuget.org, github.com, npmjs.com, ... </li>
            <li>
              the URL for curation PR from{' '}
              <a href="https://github.com/clearlydefined/curated-data">
                https://github.com/clearlydefined/curated-data
              </a>
              , ...{' '}
            </li>
            <li>a saved ClearlyDefined component list, package-lock.json, project-log.json, ... </li>
          </ul>
        </div>
      </div>
    )
  }

  doSave() {
    const { components } = this.props
    const spec = this.buildSaveSpec(components.list)
    this.saveSpec(spec)
    this.setState({ showSavePopup: false, fileName: null })
  }

  // capture this work in a serpate method so it can be spun off without waiting but still capture rejections
  async saveSpec(spec) {
    const { dispatch } = this.props
    try {
      const fileObject = { filter: this.state.activeFilters, sortBy: this.state.activeSort, coordinates: spec }
      if (this.state.saveType === 'gist') await this.createGist(this.state.fileName, fileObject)
      else {
        const file = new File([JSON.stringify(fileObject, null, 2)], `${this.state.fileName}.json`)
        saveAs(file)
      }
    } catch (error) {
      if (error.status === 404)
        return uiWarning(dispatch, "Could not create Gist. Likely you've not given us permission")
      uiWarning(dispatch, error.message)
    }
  }

  async createGist(name, content) {
    const { token, dispatch } = this.props
    const url = await saveGist(token, `${name}.json`, JSON.stringify(content))
    const message = (
      <div>
        A new Gist File has been created and is available{' '}
        <a href={url} target="_blank" rel="noopener noreferrer">
          here
        </a>
      </div>
    )
    return uiInfo(dispatch, message)
  }

  doSaveAsUrl() {
    const { components } = this.props
    const spec = this.buildSaveSpec(components.list)
    const fileObject = { filter: this.state.activeFilters, sortBy: this.state.activeSort, coordinates: spec }
    const url = `${document.location.origin}${ROUTE_SHARE}/${base64js.fromByteArray(
      pako.deflate(JSON.stringify(fileObject))
    )}`
    this.copyToClipboard(url, 'URL copied to clipboard')
  }

  copyToClipboard(text, message) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    document.execCommand('copy')
    document.body.removeChild(textArea)
    uiInfo(this.props.dispatch, message)
  }

  onDragOver = e => e.preventDefault()
  onDragEnter = e => e.preventDefault()

  onDrop = async e => {
    e.preventDefault()
    e.persist()
    try {
      if ((await this.handleTextDrop(e)) !== false) return
      if (this.handleDropFiles(e) !== false) return
      uiWarning(this.props.dispatch, 'ClearlyDefined does not understand whatever it is you just dropped')
    } catch (error) {
      uiWarning(this.props.dispatch, error.message)
    }
  }

  handleTextDrop = async event => {
    const text = event.dataTransfer.getData('Text')
    if (!text) return false
    if (this.handleDropObject(text) !== false) return
    if ((await this.handleDropGist(text)) !== false) return
    if (this.handleDropEntityUrl(text) !== false) return
    if (this.handleDropPrURL(text) !== false) return
    return false
  }

  // handle dropping a URL to an npm, github repo/release, nuget package, ...
  handleDropEntityUrl(content) {
    const spec = EntitySpec.fromUrl(content)
    if (!spec) return false
    this.onAddComponent(spec)
  }

  // dropping an actual definition, an object that has `coordinates`
  handleDropObject(content) {
    const contentObject = asObject(content)
    if (!contentObject) return false
    this.onAddComponent(EntitySpec.fromCoordinates(contentObject))
  }

  // handle dropping a url pointing to a curation PR
  handleDropPrURL(urlSpec) {
    try {
      const url = new URL(trim(urlSpec, '/'))
      if (url.hostname !== 'github.com') return false
      const [, org, , type, number] = url.pathname.split('/')
      if (org !== 'clearlydefined' || type !== 'pull') return false
      this.props.history.push(`${ROUTE_CURATIONS}/${number}`)
    } catch (exception) {
      return false
    }
  }

  // handle dropping a url to a Gist that contains a ClearlyDefined coordinate list
  async handleDropGist(urlString) {
    if (!urlString.startsWith('https://gist.github.com')) return false
    uiInfo(this.props.dispatch, 'Loading component list from gist')
    const url = new URL(urlString)
    const [, , id] = url.pathname.split('/')
    if (!id) throw new Error(`Gist url ${url} is malformed`)
    const content = await getGist(id)
    if (!content || !Object.keys(content).length) throw new Error(`Gist at ${url} could not be loaded or was empty`)
    for (let name in content) this.loadComponentList(content[name], name)
  }

  handleDropFiles(event) {
    const files = Object.values(event.dataTransfer.files)
    if (!files || !files.length) return false
    const { acceptedFiles, rejectedFiles } = this.sortDroppedFiles(files)
    if (acceptedFiles.length) this.handleDropAcceptedFiles(acceptedFiles)
    if (rejectedFiles.length) this.handleDropRejectedFiles(rejectedFiles)
  }

  sortDroppedFiles(files) {
    const acceptedFilesValues = ['application/json']
    return files.reduce(
      (result, file) => {
        if (acceptedFilesValues.includes(file.type)) result.acceptedFiles.push(file)
        else result.rejectedFiles.push(file)
        return result
      },
      { acceptedFiles: [], rejectedFiles: [] }
    )
  }

  handleDropAcceptedFiles(files) {
    uiInfo(this.props.dispatch, 'Loading component list from file(s)')
    files.forEach(file => {
      const reader = new FileReader()
      reader.onload = () => this.loadComponentList(reader.result, file.name)
      reader.readAsBinaryString(file)
    })
  }

  handleDropRejectedFiles = files => {
    const fileNames = files.map(file => file.name).join(', ')
    uiWarning(this.props.dispatch, `Could not load: ${fileNames}`)
  }

  onAddComponent(value) {
    const { dispatch, token, definitions } = this.props
    const component = typeof value === 'string' ? EntitySpec.fromPath(value) : value
    const path = component.toPath()
    if (!component.revision) return uiWarning(dispatch, `${path} needs version information`)

    !definitions.entries[path] &&
      dispatch(getDefinitionsAction(token, [path])) &&
      dispatch(getCurationAction(token, component))
    dispatch(uiBrowseUpdateList({ add: component }))
  }

  dropZone(child) {
    return (
      <div
        onDragOver={this.onDragOver}
        onDragEnter={this.onDragEnter}
        onDrop={this.onDrop}
        style={{ position: 'relative' }}
      >
        {child}
      </div>
    )
  }

  loadComponentList(content, name) {
    const list = this.getList(content)
    if (!list) return uiWarning(this.props.dispatch, `Invalid component list file: ${name}`)
    this.loadFromListSpec(list)
  }

  getList(content) {
    const object = typeof content === 'string' ? JSON.parse(content) : content
    if (this.isPackageLock(object)) return this.getListFromPackageLock(object.dependencies)
    if (this.isClearlyDefinedList(object)) return object
    return null
  }

  isPackageLock(content) {
    // TODO better, more definitive test here
    return !!content.dependencies
  }

  isClearlyDefinedList(content) {
    // TODO better, more definitive test here
    return !!content.coordinates
  }

  getListFromPackageLock(dependencies) {
    const coordinates = []
    for (const dependency in dependencies) {
      let [namespace, name] = dependency.split('/')
      if (!name) {
        name = namespace
        namespace = null
      }
      coordinates.push({ type: 'npm', provider: 'npmjs', namespace, name, revision: dependencies[dependency].version })
    }
    return { coordinates }
  }

  loadFromListSpec(list) {
    const { dispatch, definitions } = this.props
    if (list.filter) this.setState({ activeFilters: list.filter })
    if (list.sortBy) this.setState({ activeSort: list.sortBy })
    if (list.sortBy || list.filter) this.setState({ sequence: this.state.sequence + 1 })

    const toAdd = list.coordinates.map(component => EntitySpec.validateAndCreate(component)).filter(e => e)
    dispatch(uiBrowseUpdateList({ addAll: toAdd }))
    const missingDefinitions = toAdd.map(spec => spec.toPath()).filter(path => !definitions.entries[path])
    this.getDefinitionsAndNotify(missingDefinitions, 'All components have been loaded')
    dispatch(
      uiBrowseUpdateList({
        transform: this.createTransform.call(
          this,
          list.sortBy || this.state.activeSort,
          list.filter || this.state.activeFilters
        )
      })
    )
  }

  readOnly() {
    return false
  }

  render() {
    const { components, definitions, session, filterOptions } = this.props
    const { sequence, showFullDetail, path, currentComponent, currentDefinition } = this.state
    return (
      <Grid className="main-container">
        <ContributePrompt
          ref={this.contributeModal}
          session={session}
          onLogin={this.handleLogin}
          actionHandler={this.doContribute}
        />
        <SearchBar filterOptions={filterOptions} onChange={this.onAddComponent} onSearch={this.onSearch} />
        <Section name={this.tableTitle()} actionButton={this.renderButtons()}>
          {this.dropZone(
            <div className="section-body">
              <ComponentList
                readOnly={this.readOnly()}
                list={components.transformedList}
                listLength={get(components, 'headers.pagination.totalCount') || components.list.length}
                listHeight={1000}
                onRemove={this.onRemoveComponent}
                onRevert={this.revertDefinition}
                onChange={this.onChangeComponent}
                onAddComponent={this.onAddComponent}
                onInspect={this.onInspect}
                renderFilterBar={this.renderFilterBar}
                definitions={definitions}
                noRowsRenderer={this.noRowsRenderer}
                sequence={sequence}
                hasChange={this.hasChange}
                showVersionSelectorPopup={this.showVersionSelectorPopup}
              />
            </div>
          )}
        </Section>
        {currentDefinition && (
          <FullDetailPage
            modalView
            visible={showFullDetail}
            onClose={this.onInspectClose}
            onSave={this.onChangeComponent}
            path={path}
            currentDefinition={currentDefinition}
            component={currentComponent}
            readOnly={this.readOnly()}
          />
        )}
        {this.renderSavePopup()}
        {this.renderVersionSelectopPopup()}
      </Grid>
    )
  }
}

function mapStateToProps(state, ownProps) {
  return {
    token: state.session.token,
    filterValue: state.ui.browse.filter,
    path: ownProps.location.pathname.slice(ownProps.match.url.length + 1),
    filterOptions: state.ui.browse.filterList,
    components: state.ui.browse.componentList,
    definitions: state.definition.bodies,
    session: state.session
  }
}
export default connect(mapStateToProps)(PageDefinitions)
